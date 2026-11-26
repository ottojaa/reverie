import { ConflictError, FolderNameSchema } from '@reverie/shared';
import { z } from 'zod';
import { toPath } from '../services/folders/paths';
import { lockFolders } from '../services/folders/transaction';
import { trashEmptyFolder } from '../services/folders/trash';
import { createFolder as createFolderRow, renameFolder as renameFolderRow } from '../services/folders/writes';
import type { Undoer } from './undo-types';
import { defineTool, ToolError } from './types';
import { assertVisibleFolder } from './visibility';
import { dryRunShape, runWrite } from './write';

/** create_folder / rename_folder, and the undo of each. Folders are never deleted here, only created, renamed and (on undo of a create) trashed. */

const UNIQUE_VIOLATION = '23505';

export interface CreateFolderState {
    folder_id: string;
    name: string;
    path: string;
    parent_id: string | null;
}

export interface RenameFolderState {
    folder_id: string;
    name: string;
    path: string;
    /** Absent in the audit rows of renames made before folders could be nested to any depth. */
    parent_id?: string | null;
}

/**
 * Sibling names are unique among all live folders, including ones the agent cannot see, so a clash with a
 * locked folder gets the same message as a visible one.
 */
async function withNameClashMapped<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        const isClash = error instanceof ConflictError || (error as { code?: string }).code === UNIQUE_VIOLATION;

        if (isClash) throw new ToolError('That folder name is not available here: ' + name);

        throw error;
    }
}

/** The path a folder at `path` has once it is called `name`. */
function toRenamedPath(path: string, name: string): string {
    return path.substring(0, path.lastIndexOf('/') + 1) + name;
}

const createSchema = z.object({
    name: FolderNameSchema,
    parent_id: z.string().uuid().optional().describe('The folder to create it in. Leave out to create it at the top level.'),
    ...dryRunShape,
});

export const createFolder = defineTool({
    name: 'create_folder',
    description: 'Create a folder inside another folder, or at the top level when parent_id is left out. Undoable with undo_write while the folder is empty.',
    access: 'write',
    inputSchema: createSchema,
    handler: (input, ctx) =>
        runWrite({
            ctx,
            tool: 'create_folder',
            input,
            dryRun: input.dry_run,
            plan: async (trx, vis) => {
                await lockFolders(trx, vis.userId);

                const parent = input.parent_id ? await assertVisibleFolder(trx, vis, input.parent_id) : null;
                const parentId = parent?.id ?? null;
                const path = parent ? parent.path + '/' + input.name : toPath([input.name]);
                const id = crypto.randomUUID();

                return {
                    preview: { name: input.name, path },
                    changes: 1,
                    before: null,
                    after: { folder_id: id, name: input.name, path, parent_id: parentId } satisfies CreateFolderState,
                    apply: async (t) => {
                        await withNameClashMapped(input.name, () => createFolderRow(vis.userId, { id, name: input.name, parentId }, t));
                    },
                };
            },
        }),
});

export const undoCreateFolder: Undoer = async (trx, vis, entry) => {
    await lockFolders(trx, vis.userId);

    const created = entry.after as CreateFolderState;
    const folder = await assertVisibleFolder(trx, vis, created.folder_id);

    if (folder.name !== created.name || folder.parent_id !== created.parent_id) {
        throw new ToolError('Cannot undo: the folder was renamed or moved since it was created (now ' + folder.path + ')');
    }

    return {
        preview: { folder_trashed: folder.path },
        changes: 1,
        before: entry.after,
        after: null,
        apply: async (t) => {
            try {
                await trashEmptyFolder(vis.userId, folder.id, t);
            } catch (error) {
                // It counts everything in the folder, including what the agent cannot see.
                if (error instanceof ConflictError) throw new ToolError('Cannot undo: the folder is not empty');

                throw error;
            }
        },
    };
};

const renameSchema = z.object({
    folder_id: z.string().uuid(),
    new_name: FolderNameSchema,
    ...dryRunShape,
});

export const renameFolder = defineTool({
    name: 'rename_folder',
    description: 'Rename a folder; the paths of everything beneath it follow. Undoable with undo_write.',
    access: 'write',
    inputSchema: renameSchema,
    handler: (input, ctx) =>
        runWrite({
            ctx,
            tool: 'rename_folder',
            input,
            dryRun: input.dry_run,
            plan: async (trx, vis) => {
                await lockFolders(trx, vis.userId);

                const folder = await assertVisibleFolder(trx, vis, input.folder_id);
                const { id, parent_id } = folder;
                const path = toRenamedPath(folder.path, input.new_name);

                return {
                    preview: { folder_id: id, from: folder.path, to: path },
                    changes: folder.name === input.new_name ? 0 : 1,
                    before: { folder_id: id, name: folder.name, path: folder.path, parent_id } satisfies RenameFolderState,
                    after: { folder_id: id, name: input.new_name, path, parent_id } satisfies RenameFolderState,
                    apply: async (t) => {
                        await withNameClashMapped(input.new_name, () => renameFolderRow(vis.userId, id, input.new_name, t));
                    },
                };
            },
        }),
});

export const undoRenameFolder: Undoer = async (trx, vis, entry) => {
    await lockFolders(trx, vis.userId);

    const before = entry.before as RenameFolderState;
    const after = entry.after as RenameFolderState;
    const folder = await assertVisibleFolder(trx, vis, after.folder_id);

    if (after.parent_id === undefined) {
        throw new ToolError('Cannot undo: this rename was recorded before folders could be nested, so rename the folder back instead: ' + before.name);
    }

    if (folder.name !== after.name || folder.parent_id !== after.parent_id) {
        throw new ToolError('Cannot undo: the folder was renamed or moved again since (now ' + folder.path + ')');
    }

    return {
        preview: { folder_id: folder.id, from: folder.path, to: toRenamedPath(folder.path, before.name) },
        changes: 1,
        before: entry.after,
        after: entry.before,
        apply: async (t) => {
            await withNameClashMapped(before.name, () => renameFolderRow(vis.userId, folder.id, before.name, t));
        },
    };
};

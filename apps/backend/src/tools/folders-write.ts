import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { Database, Folder } from '../db/schema';
import { excludeTrashed } from '../services/privacy';
import { trashFolder } from '../services/trash-folders';
import type { Undoer } from './undo-types';
import { defineTool, ToolError } from './types';
import { assertVisibleFolder, visibleFolders, type Visibility } from './visibility';
import { dryRunShape, runWrite } from './write';

/** create_folder / rename_folder, and the undo of each. Folders are never deleted here, only created, renamed and (on undo of a create) trashed. */

type DbOrTrx = Kysely<Database>;

const FORBIDDEN_NAME = /[/\\\0]/;
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
}

function assertFolderName(name: string): void {
    if (FORBIDDEN_NAME.test(name)) throw new ToolError('Invalid folder name: it cannot contain slashes');
}

function toNameUnavailable(name: string): ToolError {
    return new ToolError('That folder name is not available here: ' + name);
}

/**
 * The unique index on live folder paths also counts folders the agent cannot see, so a clash with a
 * locked folder surfaces as a unique violation. It gets the same message as a visible clash.
 */
async function withNameClashMapped<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw toNameUnavailable(name);

        throw error;
    }
}

async function assertPathFree(trx: DbOrTrx, vis: Visibility, path: string, name: string, exceptId?: string): Promise<void> {
    let query = visibleFolders(trx, vis).select('folders.id').where('folders.path', '=', path);

    if (exceptId) query = query.where('folders.id', '!=', exceptId);

    if (await query.executeTakeFirst()) throw toNameUnavailable(name);
}

function toParentPath(path: string): string {
    return path.substring(0, path.lastIndexOf('/'));
}

const createSchema = z.object({
    name: z.string().trim().min(1).max(255),
    parent_id: z.string().uuid().optional().describe('The collection to create the folder in. Leave out to create a new collection.'),
    ...dryRunShape,
});

export const createFolder = defineTool({
    name: 'create_folder',
    description: 'Create a folder inside a collection, or a collection when parent_id is left out. Undoable with undo_write while the folder is empty.',
    access: 'write',
    inputSchema: createSchema,
    handler: (input, ctx) => {
        assertFolderName(input.name);

        return withNameClashMapped(input.name, () =>
            runWrite({
                ctx,
                tool: 'create_folder',
                input,
                dryRun: input.dry_run,
                plan: async (trx, vis) => {
                    const parent = input.parent_id ? await assertVisibleFolder(trx, vis, input.parent_id) : null;

                    if (parent && parent.type !== 'collection') throw new ToolError('Folders can only be created in a collection: ' + parent.id);

                    const path = (parent?.path ?? '') + '/' + input.name;

                    await assertPathFree(trx, vis, path, input.name);

                    const id = crypto.randomUUID();

                    return {
                        preview: { name: input.name, path, type: parent ? 'folder' : 'collection' },
                        changes: 1,
                        before: null,
                        after: { folder_id: id, name: input.name, path, parent_id: parent?.id ?? null } satisfies CreateFolderState,
                        apply: async (t) => {
                            const siblings = await excludeTrashed(
                                t
                                    .selectFrom('folders')
                                    .select(sql<number>`coalesce(max(sort_order), -1) + 1`.as('next'))
                                    .where('user_id', '=', vis.userId)
                                    .where('parent_id', parent ? '=' : 'is', parent?.id ?? null),
                                '',
                            ).executeTakeFirstOrThrow();

                            await t
                                .insertInto('folders')
                                .values({
                                    id,
                                    user_id: vis.userId,
                                    name: input.name,
                                    parent_id: parent?.id ?? null,
                                    path,
                                    sort_order: Number(siblings.next),
                                    type: parent ? 'folder' : 'collection',
                                })
                                .execute();
                        },
                    };
                },
            }),
        );
    },
});

/** Live documents and live child folders in a folder, counting ones the agent cannot see: trashing the folder moves them all. */
async function countLiveContents(trx: DbOrTrx, userId: string, folderId: string): Promise<number> {
    const docs = await excludeTrashed(
        trx
            .selectFrom('documents')
            .select(sql<number>`count(*)`.as('n'))
            .where('user_id', '=', userId)
            .where('folder_id', '=', folderId),
        '',
    ).executeTakeFirstOrThrow();
    const children = await excludeTrashed(
        trx
            .selectFrom('folders')
            .select(sql<number>`count(*)`.as('n'))
            .where('user_id', '=', userId)
            .where('parent_id', '=', folderId),
        '',
    ).executeTakeFirstOrThrow();

    return Number(docs.n) + Number(children.n);
}

export const undoCreateFolder: Undoer = async (trx, vis, entry) => {
    const created = entry.after as CreateFolderState;
    const folder = await assertVisibleFolder(trx, vis, created.folder_id);

    if (folder.path !== created.path) throw new ToolError('Cannot undo: the folder was renamed since it was created (now ' + folder.name + ')');

    if ((await countLiveContents(trx, vis.userId, folder.id)) > 0) throw new ToolError('Cannot undo: the folder is not empty');

    return {
        preview: { folder_trashed: created.path },
        changes: 1,
        before: entry.after,
        after: null,
        apply: (t) => trashFolder(vis.userId, folder.id, t),
    };
};

async function renameIn(trx: DbOrTrx, folder: Folder, name: string, path: string): Promise<void> {
    await trx.updateTable('folders').set({ name, path, updated_at: new Date() }).where('id', '=', folder.id).execute();

    if (folder.type !== 'collection') return;

    // Child paths embed the collection name; locked children are re-pathed too so no path goes stale.
    await excludeTrashed(
        trx
            .updateTable('folders')
            .set({ path: sql<string>`${path} || '/' || name` })
            .where('parent_id', '=', folder.id),
        '',
    ).execute();
}

const renameSchema = z.object({
    folder_id: z.string().uuid(),
    new_name: z.string().trim().min(1).max(255),
    ...dryRunShape,
});

export const renameFolder = defineTool({
    name: 'rename_folder',
    description: 'Rename a collection or folder. Undoable with undo_write.',
    access: 'write',
    inputSchema: renameSchema,
    handler: (input, ctx) => {
        assertFolderName(input.new_name);

        return withNameClashMapped(input.new_name, () =>
            runWrite({
                ctx,
                tool: 'rename_folder',
                input,
                dryRun: input.dry_run,
                plan: async (trx, vis) => {
                    const folder = await assertVisibleFolder(trx, vis, input.folder_id);
                    const path = toParentPath(folder.path) + '/' + input.new_name;
                    const unchanged = folder.name === input.new_name;

                    if (!unchanged) await assertPathFree(trx, vis, path, input.new_name, folder.id);

                    return {
                        preview: { folder_id: folder.id, from: folder.path, to: path },
                        changes: unchanged ? 0 : 1,
                        before: { folder_id: folder.id, name: folder.name, path: folder.path } satisfies RenameFolderState,
                        after: { folder_id: folder.id, name: input.new_name, path } satisfies RenameFolderState,
                        apply: (t) => renameIn(t, folder, input.new_name, path),
                    };
                },
            }),
        );
    },
});

export const undoRenameFolder: Undoer = async (trx, vis, entry) => {
    const before = entry.before as RenameFolderState;
    const after = entry.after as RenameFolderState;
    const folder = await assertVisibleFolder(trx, vis, after.folder_id);

    if (folder.path !== after.path) throw new ToolError('Cannot undo: the folder was renamed or moved again since (now ' + folder.path + ')');

    await withNameClashMapped(before.name, () => assertPathFree(trx, vis, before.path, before.name, folder.id));

    return {
        preview: { folder_id: folder.id, from: after.path, to: before.path },
        changes: 1,
        before: entry.after,
        after: entry.before,
        apply: (t) => withNameClashMapped(before.name, () => renameIn(t, folder, before.name, before.path)),
    };
};

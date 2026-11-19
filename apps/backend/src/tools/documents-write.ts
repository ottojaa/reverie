import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { Undoer } from './undo-types';
import { defineTool, ToolError } from './types';
import { assertVisibleDocuments, assertVisibleFolder, visibleDocuments, type Visibility } from './visibility';
import { dryRunShape, documentTargetShape, PREVIEW_SAMPLE_SIZE, rebuildSearchVectors, resolveDocumentIds, runWrite } from './write';

/** move_documents / rename_document, and the undo of each. */

type DbOrTrx = Kysely<Database>;

export interface MoveState {
    moves: Array<{ id: string; folder_id: string | null }>;
}

export interface MoveAfterState {
    folder_id: string;
    document_ids: string[];
}

export interface RenameDocumentState {
    document_id: string;
    name: string;
    folder_id: string | null;
}

async function assertMoveTarget(trx: DbOrTrx, vis: Visibility, folderId: string) {
    const folder = await assertVisibleFolder(trx, vis, folderId);

    if (folder.type !== 'folder') throw new ToolError('Documents can only be moved into a folder, not a collection: ' + folderId);

    return folder;
}

/** The folder an undo puts documents back into: a folder or a collection, as long as it is live and visible. The message does not say which of gone, trashed or locked it is. */
async function assertOriginAvailable(trx: DbOrTrx, vis: Visibility, folderId: string): Promise<void> {
    try {
        await assertVisibleFolder(trx, vis, folderId);
    } catch (error) {
        if (error instanceof ToolError) throw new ToolError('Cannot undo: the folder the documents came from is no longer available');

        throw error;
    }
}

/** Visible documents in `folderId` that already use one of `names`. Locked ones are not counted: that would reveal them. */
async function findNamesTakenIn(trx: DbOrTrx, vis: Visibility, folderId: string, names: string[], exceptIds: string[]): Promise<string[]> {
    if (names.length === 0) return [];

    let query = visibleDocuments(trx, vis)
        .select('documents.original_filename')
        .where('documents.folder_id', '=', folderId)
        .where('documents.original_filename', 'in', names);

    if (exceptIds.length > 0) query = query.where('documents.id', 'not in', exceptIds);

    return (await query.execute()).map((row) => row.original_filename);
}

async function loadFolderPaths(trx: DbOrTrx, ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = Array.from(new Set(ids.filter((id): id is string => id !== null)));

    if (wanted.length === 0) return new Map();

    const rows = await trx.selectFrom('folders').select(['id', 'path']).where('id', 'in', wanted).execute();

    return new Map(rows.map((row) => [row.id, row.path]));
}

function assertNoNameClash(taken: string[], moving: string[]): void {
    const duplicates = moving.filter((name, index) => moving.indexOf(name) !== index);
    const clashes = Array.from(new Set([...taken, ...duplicates]));

    if (clashes.length === 0) return;

    throw new ToolError('Cannot move: ' + clashes.length + ' filename(s) would clash in the target folder (e.g. ' + clashes[0] + '). Rename them first.');
}

const moveSchema = z.object({
    ...documentTargetShape,
    folder_id: z.string().uuid().describe('The folder to move into (a folder, not a collection)'),
    ...dryRunShape,
});

export const moveDocuments = defineTool({
    name: 'move_documents',
    description: 'Move documents into a folder, by ids or by a search selection. Undoable with undo_write.',
    access: 'write',
    inputSchema: moveSchema,
    handler: async (input, ctx) => {
        const ids = await resolveDocumentIds(ctx.user.id, input);

        return runWrite({
            ctx,
            tool: 'move_documents',
            input,
            dryRun: input.dry_run,
            plan: async (trx, vis) => {
                const target = await assertMoveTarget(trx, vis, input.folder_id);
                const docs = await assertVisibleDocuments(trx, vis, ids);
                const moving = docs.filter((doc) => doc.folder_id !== target.id);
                const taken = await findNamesTakenIn(
                    trx,
                    vis,
                    target.id,
                    moving.map((doc) => doc.original_filename),
                    moving.map((doc) => doc.id),
                );

                assertNoNameClash(
                    taken,
                    moving.map((doc) => doc.original_filename),
                );

                const fromPaths = await loadFolderPaths(
                    trx,
                    moving.slice(0, PREVIEW_SAMPLE_SIZE).map((doc) => doc.folder_id),
                );
                const sample = moving
                    .slice(0, PREVIEW_SAMPLE_SIZE)
                    .map((doc) => ({ id: doc.id, filename: doc.original_filename, from: doc.folder_id ? fromPaths.get(doc.folder_id) : null }));

                return {
                    preview: {
                        target: { id: target.id, path: target.path },
                        documents: docs.length,
                        moved: moving.length,
                        already_there: docs.length - moving.length,
                        sample,
                    },
                    changes: moving.length,
                    before: { moves: moving.map((doc) => ({ id: doc.id, folder_id: doc.folder_id })) } satisfies MoveState,
                    after: { folder_id: target.id, document_ids: moving.map((doc) => doc.id) } satisfies MoveAfterState,
                    apply: async (t) => {
                        await t
                            .updateTable('documents')
                            .set({ folder_id: target.id, updated_at: new Date() })
                            .where(
                                'id',
                                'in',
                                moving.map((doc) => doc.id),
                            )
                            .execute();
                    },
                };
            },
        });
    },
});

export const undoMove: Undoer = async (trx, vis, entry) => {
    const { moves } = entry.before as MoveState;
    const after = entry.after as MoveAfterState;
    const docs = await assertVisibleDocuments(trx, vis, after.document_ids);
    const moved = docs.filter((doc) => doc.folder_id !== after.folder_id);

    if (moved.length > 0)
        throw new ToolError('Cannot undo: ' + moved.length + ' document(s) are no longer where the move put them (e.g. ' + moved[0]!.original_filename + ')');

    const origins = Array.from(new Set(moves.map((move) => move.folder_id).filter((id): id is string => id !== null)));

    for (const folderId of origins) await assertOriginAvailable(trx, vis, folderId);

    const filenames = new Map(docs.map((doc) => [doc.id, doc.original_filename]));

    for (const folderId of origins) {
        const group = moves.filter((move) => move.folder_id === folderId);
        const taken = await findNamesTakenIn(
            trx,
            vis,
            folderId,
            group.map((move) => filenames.get(move.id)!),
            group.map((move) => move.id),
        );

        assertNoNameClash(
            taken,
            group.map((move) => filenames.get(move.id)!),
        );
    }

    return {
        preview: {
            documents_moved_back: moves.length,
            sample: moves.slice(0, PREVIEW_SAMPLE_SIZE).map((move) => ({ id: move.id, filename: filenames.get(move.id) })),
        },
        changes: moves.length,
        before: entry.after,
        after: entry.before,
        apply: async (t) => {
            const groups = Array.from(new Set(moves.map((move) => move.folder_id)));

            for (const folderId of groups) {
                await t
                    .updateTable('documents')
                    .set({ folder_id: folderId, updated_at: new Date() })
                    .where(
                        'id',
                        'in',
                        moves.filter((move) => move.folder_id === folderId).map((move) => move.id),
                    )
                    .execute();
            }
        },
    };
};

const renameSchema = z.object({
    document_id: z.string().uuid(),
    new_name: z.string().trim().min(1).max(255).describe('The new filename, including its extension'),
    ...dryRunShape,
});

const FORBIDDEN_NAME = /[/\\\0]/;

export const renameDocument = defineTool({
    name: 'rename_document',
    description: "Rename a document's filename. Undoable with undo_write.",
    access: 'write',
    inputSchema: renameSchema,
    handler: async (input, ctx) => {
        if (FORBIDDEN_NAME.test(input.new_name)) throw new ToolError('Invalid filename: it cannot contain slashes');

        return runWrite({
            ctx,
            tool: 'rename_document',
            input,
            dryRun: input.dry_run,
            plan: async (trx, vis) => {
                const [doc] = await assertVisibleDocuments(trx, vis, [input.document_id]);
                const unchanged = doc!.original_filename === input.new_name;
                const taken = doc!.folder_id && !unchanged ? await findNamesTakenIn(trx, vis, doc!.folder_id, [input.new_name], [doc!.id]) : [];

                if (taken.length > 0) throw new ToolError('A document with this filename already exists in this folder');

                return {
                    preview: { document_id: doc!.id, from: doc!.original_filename, to: input.new_name },
                    changes: unchanged ? 0 : 1,
                    before: { document_id: doc!.id, name: doc!.original_filename, folder_id: doc!.folder_id } satisfies RenameDocumentState,
                    after: { document_id: doc!.id, name: input.new_name, folder_id: doc!.folder_id } satisfies RenameDocumentState,
                    apply: async (t) => {
                        await t.updateTable('documents').set({ original_filename: input.new_name, updated_at: new Date() }).where('id', '=', doc!.id).execute();
                        await rebuildSearchVectors(t, [doc!.id]);
                    },
                };
            },
        });
    },
});

export const undoRenameDocument: Undoer = async (trx, vis, entry) => {
    const before = entry.before as RenameDocumentState;
    const after = entry.after as RenameDocumentState;
    const [doc] = await assertVisibleDocuments(trx, vis, [after.document_id]);

    if (doc!.original_filename !== after.name) throw new ToolError('Cannot undo: the document was renamed again since (now ' + doc!.original_filename + ')');

    if (doc!.folder_id !== after.folder_id) throw new ToolError('Cannot undo: the document was moved since');

    const taken = doc!.folder_id ? await findNamesTakenIn(trx, vis, doc!.folder_id, [before.name], [doc!.id]) : [];

    if (taken.length > 0) throw new ToolError('Cannot undo: another document in this folder now has the original filename');

    return {
        preview: { document_id: doc!.id, from: after.name, to: before.name },
        changes: 1,
        before: entry.after,
        after: entry.before,
        apply: async (t) => {
            await t.updateTable('documents').set({ original_filename: before.name, updated_at: new Date() }).where('id', '=', doc!.id).execute();
            await rebuildSearchVectors(t, [doc!.id]);
        },
    };
};

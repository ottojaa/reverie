import { ConflictError, FolderNameSchema, ValidationError } from '@reverie/shared';
import type { Kysely } from 'kysely';
import type { Database, Folder, FolderUpdate } from '../../db/schema.js';
import { assertLiveFolder, loadFolderTree } from './load.js';
import { isNameTaken, rewritePaths, toFolderType, toNamePath, toPath } from './paths.js';
import type { FolderTree } from './snapshot.js';
import { inFolderTransaction } from './transaction.js';

/**
 * Creating, renaming, moving and ordering folders. Together with trash.ts and purge.ts this is the only code
 * that writes a folder's `parent_id`, `path` or `name`. Who may do it (folder locks) is the caller's check.
 */

type DbOrTrx = Kysely<Database>;

export interface NewFolderInput {
    /** Set when the caller needs the id before the folder exists. */
    id?: string | undefined;
    name: string;
    /** Left out or null: the top level. */
    parentId?: string | null | undefined;
    description?: string | undefined;
    emoji?: string | null | undefined;
}

export interface FolderChanges {
    name?: string | undefined;
    /** null moves the folder to the top level; left out keeps it where it is. */
    parent_id?: string | null | undefined;
    description?: string | null | undefined;
    emoji?: string | null | undefined;
    is_private?: boolean | undefined;
}

function toValidName(name: string): string {
    const parsed = FolderNameSchema.safeParse(name);

    if (!parsed.success) throw new ValidationError('Invalid folder name: ' + name);

    return parsed.data;
}

async function assertNameFree(trx: DbOrTrx, userId: string, parentId: string | null, name: string, exceptId?: string): Promise<void> {
    if (await isNameTaken(trx, userId, parentId, name, exceptId)) throw new ConflictError('A folder with this name already exists here: ' + name);
}

function toNextSortOrder(siblings: Folder[]): number {
    return siblings.reduce((next, sibling) => Math.max(next, sibling.sort_order + 1), 0);
}

export function createFolder(userId: string, input: NewFolderInput, trx?: DbOrTrx): Promise<Folder> {
    return inFolderTransaction(
        userId,
        async (t) => {
            const name = toValidName(input.name);
            const parentId = input.parentId ?? null;
            const tree = await loadFolderTree(userId, t);
            const above = parentId === null ? [] : toNamePath(tree, assertLiveFolder(tree, parentId));

            await assertNameFree(t, userId, parentId, name);

            return t
                .insertInto('folders')
                .values({
                    ...(input.id !== undefined && { id: input.id }),
                    user_id: userId,
                    name,
                    parent_id: parentId,
                    path: toPath([...above, name]),
                    description: input.description ?? null,
                    emoji: input.emoji ?? null,
                    sort_order: toNextSortOrder(tree.children(parentId)),
                    type: toFolderType(parentId),
                })
                .returningAll()
                .executeTakeFirstOrThrow();
        },
        trx,
    );
}

/** A folder cannot go inside itself or anything beneath it. */
function assertCanMove(tree: FolderTree<Folder>, folder: Folder, parentId: string | null): void {
    if (parentId === null) return;

    assertLiveFolder(tree, parentId);

    if (tree.subtree(folder.id, { trashed: true }).some((inside) => inside.id === parentId)) {
        throw new ConflictError('Cannot move a folder into itself or into a folder inside it');
    }
}

/** The columns an update changes. A moved folder goes behind its new siblings. */
function toFolderUpdate(tree: FolderTree<Folder>, folder: Folder, changes: FolderChanges): FolderUpdate {
    const parentId = changes.parent_id === undefined ? folder.parent_id : changes.parent_id;
    const name = changes.name === undefined ? folder.name : toValidName(changes.name);
    const isMoved = parentId !== folder.parent_id;

    if (isMoved) assertCanMove(tree, folder, parentId);

    return {
        ...((isMoved || name !== folder.name) && { name, parent_id: parentId }),
        ...(isMoved && { sort_order: toNextSortOrder(tree.children(parentId)) }),
        ...(changes.description !== undefined && { description: changes.description }),
        ...(changes.emoji !== undefined && { emoji: changes.emoji }),
        ...(changes.is_private !== undefined && { is_private: changes.is_private }),
    };
}

/** Renames, moves and edits a folder in one step, so a move that also renames is judged by where it ends up. */
export function updateFolder(userId: string, id: string, changes: FolderChanges, trx?: DbOrTrx): Promise<Folder> {
    return inFolderTransaction(
        userId,
        async (t) => {
            const tree = await loadFolderTree(userId, t);
            const folder = assertLiveFolder(tree, id);
            const update = toFolderUpdate(tree, folder, changes);

            if (Object.keys(update).length === 0) return folder;

            // `name` and `parent_id` are only set when one of them changes.
            if (update.name !== undefined) await assertNameFree(t, userId, update.parent_id!, update.name, id);

            await t.updateTable('folders').set(update).where('id', '=', id).execute();

            if (update.name !== undefined) await rewritePaths(t, userId, id);

            return t.selectFrom('folders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        },
        trx,
    );
}

export function renameFolder(userId: string, id: string, name: string, trx?: DbOrTrx): Promise<Folder> {
    return updateFolder(userId, id, { name }, trx);
}

export function moveFolder(userId: string, id: string, parentId: string | null, trx?: DbOrTrx): Promise<Folder> {
    return updateFolder(userId, id, { parent_id: parentId }, trx);
}

/** The folder that all the given folders sit in (null: the top level). Ids that are not live folders are ignored. */
export function toSharedParentId(tree: FolderTree<Folder>, ids: string[]): string | null {
    const parents = new Set(
        ids.flatMap((id) => {
            const folder = tree.folder(id);

            return folder && folder.deleted_at === null ? [folder.parent_id] : [];
        }),
    );

    if (parents.size > 1) throw new ConflictError('Folders can only be reordered among folders in the same place');

    return parents.values().next().value ?? null;
}

export function reorderFolders(userId: string, updates: Array<{ id: string; sort_order: number }>, trx?: DbOrTrx): Promise<void> {
    return inFolderTransaction(
        userId,
        async (t) => {
            toSharedParentId(
                await loadFolderTree(userId, t),
                updates.map((update) => update.id),
            );

            for (const { id, sort_order } of updates) {
                await t.updateTable('folders').set({ sort_order }).where('id', '=', id).where('user_id', '=', userId).execute();
            }
        },
        trx,
    );
}

/**
 * How far `names` already exists below `parentId`, matching names in any case: the deepest folder reached
 * (`parentId` itself when none is) and the names still to be created.
 */
export function findByNames(tree: FolderTree<Folder>, parentId: string | null, names: string[]): { deepestId: string | null; missing: string[] } {
    let deepestId = parentId;

    for (const [index, name] of names.entries()) {
        const found = tree.children(deepestId).find((child) => child.name.toLowerCase() === name.trim().toLowerCase());

        if (!found) return { deepestId, missing: names.slice(index) };

        deepestId = found.id;
    }

    return { deepestId, missing: [] };
}

/** The folder reached by walking `names` down from `parentId`, creating the ones that are not there yet. */
export function getOrCreateFolders(
    userId: string,
    parentId: string | null,
    names: string[],
    trx?: DbOrTrx,
): Promise<{ folderId: string; createdCount: number }> {
    return inFolderTransaction(
        userId,
        async (t) => {
            const tree = await loadFolderTree(userId, t);

            if (parentId !== null) assertLiveFolder(tree, parentId);

            const { deepestId, missing } = findByNames(tree, parentId, names);
            let folderId = deepestId;

            for (const name of missing) folderId = (await createFolder(userId, { name, parentId: folderId }, t)).id;

            if (folderId === null) throw new ValidationError('A folder name is required');

            return { folderId, createdCount: missing.length };
        },
        trx,
    );
}

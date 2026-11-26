import { ConflictError, NotFoundError } from '@reverie/shared';
import type { Kysely } from 'kysely';
import type { Database, Document, Folder } from '../../db/schema.js';
import { excludeTrashed } from '../privacy.js';
import { assertLiveFolder, loadFolderTree } from './load.js';
import { isNameTaken, rewritePaths, toSuffixedName } from './paths.js';
import type { FolderTree } from './snapshot.js';
import { inFolderTransaction } from './transaction.js';

/**
 * Folder half of the trash. A folder goes to the trash with everything beneath it, as one unit: the folders
 * and documents get the same timestamp and keep their place, so restoring brings them back where they were,
 * private ones still private. Whatever was trashed earlier keeps its own timestamp and is its own unit.
 */

type DbOrTrx = Kysely<Database>;

function isTrashedAt(row: { deleted_at: Date | null }, at: Date | null): boolean {
    return row.deleted_at !== null && row.deleted_at.getTime() === at?.getTime();
}

async function trashIn(t: DbOrTrx, tree: FolderTree<Folder>, root: Folder): Promise<void> {
    const subtree = tree.subtree(root.id, { trashed: true });
    const now = new Date();

    await excludeTrashed(
        t
            .updateTable('documents')
            .set({ deleted_at: now })
            .where(
                'folder_id',
                'in',
                subtree.map((folder) => folder.id),
            )
            .where('user_id', '=', root.user_id),
        '',
    ).execute();
    await excludeTrashed(
        t
            .updateTable('folders')
            .set({ deleted_at: now })
            .where(
                'id',
                'in',
                subtree.map((folder) => folder.id),
            ),
        '',
    ).execute();
}

export function trashFolder(userId: string, id: string, trx?: DbOrTrx): Promise<void> {
    return inFolderTransaction(
        userId,
        async (t) => {
            const tree = await loadFolderTree(userId, t);

            await trashIn(t, tree, assertLiveFolder(tree, id));
        },
        trx,
    );
}

/** Trashes a folder only if it holds no live document and no live folder. */
export function trashEmptyFolder(userId: string, id: string, trx?: DbOrTrx): Promise<void> {
    return inFolderTransaction(
        userId,
        async (t) => {
            const tree = await loadFolderTree(userId, t);
            const folder = assertLiveFolder(tree, id);
            const document = await excludeTrashed(t.selectFrom('documents').select('id').where('folder_id', '=', id).where('user_id', '=', userId), '')
                .limit(1)
                .executeTakeFirst();

            if (document) throw new ConflictError('Cannot delete folder: it contains documents');

            if (tree.children(id).length > 0) throw new ConflictError('Cannot delete folder: it contains subfolders');

            await trashIn(t, tree, folder);
        },
        trx,
    );
}

/** A trashed folder that is not part of the unit of the folder above it: it has its own entry in the trash. */
export function isUnitRoot(tree: FolderTree<Folder>, folder: Folder): boolean {
    if (folder.deleted_at === null) return false;

    const parent = folder.parent_id === null ? undefined : tree.folder(folder.parent_id);

    return !parent || !isTrashedAt(parent, folder.deleted_at);
}

/** `root` and the folders beneath it that went to the trash with it, parents first. */
export function toTrashUnit(tree: FolderTree<Folder>, root: Folder): Folder[] {
    const ids = new Set([root.id]);

    return tree.subtree(root.id, { trashed: true }).filter((folder) => {
        if (folder.id === root.id) return true;

        if (!ids.has(folder.parent_id!) || !isTrashedAt(folder, root.deleted_at)) return false;

        ids.add(folder.id);

        return true;
    });
}

export interface TrashUnitCounts {
    folder_count: number;
    document_count: number;
}

/**
 * What went to the trash with `root`, as far as someone who may see `root` can see: a private folder inside a
 * public one counts as a folder, but nothing beneath it is counted.
 */
export function toUnitCounts(tree: FolderTree<Folder>, root: Folder, trashed: readonly Document[]): TrashUnitCounts {
    const zone = tree.lockOf(root.id);
    const unit = toTrashUnit(tree, root);
    const visible = new Set(unit.filter((folder) => tree.lockOf(folder.id) === zone).map((folder) => folder.id));

    return {
        folder_count: unit.filter((folder) => folder.id !== root.id && visible.has(folder.parent_id!)).length,
        document_count: trashed.filter((doc) => doc.folder_id !== null && visible.has(doc.folder_id) && isTrashedAt(doc, root.deleted_at)).length,
    };
}

/** The folder's own name, or "name (restored)", "name (restored 2)", ... when a live folder has taken it. */
async function findRestoreName(t: DbOrTrx, folder: Folder): Promise<string> {
    let name = folder.name;

    for (let attempt = 1; await isNameTaken(t, folder.user_id, folder.parent_id, name, folder.id); attempt++) {
        name = toSuffixedName(folder.name, attempt === 1 ? ' (restored)' : ` (restored ${attempt})`);
    }

    return name;
}

async function restoreUnit(t: DbOrTrx, tree: FolderTree<Folder>, root: Folder): Promise<Folder> {
    const unit = toTrashUnit(tree, root);

    for (const folder of unit) {
        const name = await findRestoreName(t, folder);

        await t.updateTable('folders').set({ name, deleted_at: null }).where('id', '=', folder.id).execute();
    }

    // Nothing can be added to a folder while it is in the trash, so the names of these documents cannot clash.
    await t
        .updateTable('documents')
        .set({ deleted_at: null })
        .where(
            'folder_id',
            'in',
            unit.map((folder) => folder.id),
        )
        .where('deleted_at', '=', root.deleted_at)
        .execute();
    await rewritePaths(t, root.user_id, root.id);

    return t.selectFrom('folders').selectAll().where('id', '=', root.id).executeTakeFirstOrThrow();
}

async function restoreIn(t: DbOrTrx, userId: string, id: string): Promise<Folder> {
    const tree = await loadFolderTree(userId, t);
    const folder = tree.folder(id);

    if (!folder?.deleted_at) throw new NotFoundError('Trashed folder', id);

    const parent = folder.parent_id === null ? undefined : tree.folder(folder.parent_id);

    if (!parent?.deleted_at) return restoreUnit(t, tree, folder);

    await restoreIn(t, userId, parent.id);

    // Restoring the folder above may already have brought this one back with it.
    const after = await loadFolderTree(userId, t);
    const current = after.folder(id)!;

    return current.deleted_at ? restoreUnit(t, after, current) : current;
}

/** Restores a trashed folder with what went to the trash with it; a trashed folder above it is restored first. */
export function restoreFolder(userId: string, id: string, trx?: DbOrTrx): Promise<Folder> {
    return inFolderTransaction(userId, (t) => restoreIn(t, userId, id), trx);
}

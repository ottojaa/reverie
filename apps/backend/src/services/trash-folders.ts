import { NotFoundError } from '@reverie/shared';
import type { Kysely } from 'kysely';
import { db } from '../db/kysely';
import type { Database, Folder } from '../db/schema';
import { excludeTrashed } from './privacy';

/**
 * Folder half of the trash. A folder is only a name, so trashing one never touches the files of
 * the documents that were in it: live documents drop to the root (exactly what the old hard
 * delete did through ON DELETE SET NULL) and the folder row is kept for a later restore.
 */

type DbOrTrx = Kysely<Database>;

function inTransaction<T>(trx: DbOrTrx | undefined, run: (t: DbOrTrx) => Promise<T>): Promise<T> {
    return trx ? run(trx) : db.transaction().execute(run);
}

/** Trash a folder. A collection takes its live child folders along, under one timestamp. */
export function trashFolder(userId: string, id: string, trx?: DbOrTrx): Promise<void> {
    return inTransaction(trx, async (t) => {
        const folder = await excludeTrashed(t.selectFrom('folders').selectAll().where('id', '=', id).where('user_id', '=', userId), '').executeTakeFirst();

        if (!folder) throw new NotFoundError('Folder', id);

        const children =
            folder.type === 'collection'
                ? await excludeTrashed(t.selectFrom('folders').select('id').where('parent_id', '=', id).where('user_id', '=', userId), '').execute()
                : [];
        const ids = [id, ...children.map((child) => child.id)];

        // Live documents go to the root; trashed ones keep their folder so a restore can put them back.
        await excludeTrashed(t.updateTable('documents').set({ folder_id: null }).where('folder_id', 'in', ids).where('user_id', '=', userId), '').execute();
        await t.updateTable('folders').set({ deleted_at: new Date() }).where('id', 'in', ids).execute();
    });
}

async function isPathTaken(t: DbOrTrx, userId: string, path: string): Promise<boolean> {
    const row = await excludeTrashed(t.selectFrom('folders').select('id').where('user_id', '=', userId).where('path', '=', path), '').executeTakeFirst();

    return row !== undefined;
}

/** Bring one trashed folder back under `parentPath`, renaming it if a live folder took its name. */
async function restoreOne(t: DbOrTrx, folder: Folder, parentPath: string): Promise<Folder> {
    let name = folder.name;

    for (let attempt = 1; await isPathTaken(t, folder.user_id, `${parentPath}/${name}`); attempt++) {
        name = attempt === 1 ? `${folder.name} (restored)` : `${folder.name} (restored ${attempt})`;
    }

    return t
        .updateTable('folders')
        .set({ name, path: `${parentPath}/${name}`, deleted_at: null, updated_at: new Date() })
        .where('id', '=', folder.id)
        .returningAll()
        .executeTakeFirstOrThrow();
}

async function fetchTrashedFolder(t: DbOrTrx, userId: string, id: string): Promise<Folder | undefined> {
    return t.selectFrom('folders').selectAll().where('id', '=', id).where('user_id', '=', userId).where('deleted_at', 'is not', null).executeTakeFirst();
}

async function restoreIn(t: DbOrTrx, userId: string, id: string): Promise<Folder> {
    const folder = await fetchTrashedFolder(t, userId, id);

    if (!folder) throw new NotFoundError('Trashed folder', id);

    if (folder.parent_id === null) {
        const restored = await restoreOne(t, folder, '');
        const trashedWithIt = await t
            .selectFrom('folders')
            .selectAll()
            .where('parent_id', '=', id)
            .where('user_id', '=', userId)
            .where('deleted_at', '=', folder.deleted_at)
            .execute();

        // Child folders trashed together with the collection come back with it, re-pathed.
        for (const child of trashedWithIt) await restoreOne(t, child, restored.path);

        return restored;
    }

    const parent = await t.selectFrom('folders').selectAll().where('id', '=', folder.parent_id).executeTakeFirstOrThrow();
    const livePath = parent.deleted_at ? (await restoreIn(t, userId, parent.id)).path : parent.path;
    // Restoring the collection may already have brought this folder back with it.
    const stillTrashed = await fetchTrashedFolder(t, userId, id);

    if (!stillTrashed) return t.selectFrom('folders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

    return restoreOne(t, stillTrashed, livePath);
}

/** Restore a trashed folder (empty); a trashed parent collection is restored first. */
export function restoreFolder(userId: string, id: string, trx?: DbOrTrx): Promise<Folder> {
    return inTransaction(trx, (t) => restoreIn(t, userId, id));
}

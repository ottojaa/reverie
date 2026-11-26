import { NotFoundError } from '@reverie/shared';
import type { Kysely } from 'kysely';
import { db } from '../../db/kysely.js';
import type { Database, Folder } from '../../db/schema.js';
import { toFolderTree, type FolderTree } from './snapshot.js';

/** Every folder of a user, trashed ones included. */
export async function loadFolderTree(userId: string, conn: Kysely<Database> = db): Promise<FolderTree<Folder>> {
    return toFolderTree(await conn.selectFrom('folders').selectAll().where('user_id', '=', userId).execute());
}

/** The folder, when it is this user's and not in the trash. */
export function findLiveFolder(userId: string, id: string, conn: Kysely<Database> = db): Promise<Folder | undefined> {
    return conn.selectFrom('folders').selectAll().where('id', '=', id).where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();
}

export function assertLiveFolder(tree: FolderTree<Folder>, id: string): Folder {
    const folder = tree.folder(id);

    if (!folder || folder.deleted_at !== null) throw new NotFoundError('Folder', id);

    return folder;
}

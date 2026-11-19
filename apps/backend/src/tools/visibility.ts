import type { Kysely } from 'kysely';
import { db } from '../db/kysely';
import type { Database, Folder } from '../db/schema';
import { excludePrivateDocuments, excludePrivateFolders, excludeTrashed, getPrivateFolderIds } from '../services/privacy';
import { ToolError } from './types';

/**
 * The one place that decides what a tool may see or touch: the user's own documents and folders
 * that are neither trashed nor locked (own flag, folder, or collection). Every read goes through
 * these query builders, and every write re-checks its targets with the assert helpers inside its
 * transaction, so an item locked or trashed after a search cannot be reached through its id or an
 * old selection. Nothing here, or anywhere in tools/, can unlock anything.
 *
 * A refusal for a locked or trashed item must read exactly like one for an id that does not exist,
 * so the error text never says which of the two it was.
 */

type DbOrTrx = Kysely<Database>;

export interface Visibility {
    userId: string;
    privateFolderIds: string[];
}

export async function loadVisibility(userId: string): Promise<Visibility> {
    return { userId, privateFolderIds: await getPrivateFolderIds(userId) };
}

/** Bare `documents` query limited to what the user can see. */
export function visibleDocuments(conn: DbOrTrx, vis: Visibility) {
    const base = conn.selectFrom('documents').where('documents.user_id', '=', vis.userId);

    return excludePrivateDocuments(excludeTrashed(base, 'documents.'), vis.privateFolderIds, '');
}

/** Bare `folders` query limited to what the user can see. */
export function visibleFolders(conn: DbOrTrx, vis: Visibility) {
    const base = conn.selectFrom('folders').where('folders.user_id', '=', vis.userId);

    return excludePrivateFolders(excludeTrashed(base, 'folders.'), vis.privateFolderIds, 'folders.id');
}

/** Whether a folder id is one of the user's private (locked) folders. */
export function isLockedFolder(vis: Visibility, folderId: string): boolean {
    return vis.privateFolderIds.includes(folderId);
}

const MAX_LISTED_IDS = 5;

function toNotFoundMessage(missing: string[]): string {
    const listed = missing.slice(0, MAX_LISTED_IDS).join(', ');
    const more = missing.length > MAX_LISTED_IDS ? ' and ' + (missing.length - MAX_LISTED_IDS) + ' more' : '';

    return 'Documents not found: ' + listed + more;
}

export interface VisibleDocument {
    id: string;
    original_filename: string;
    folder_id: string | null;
}

/**
 * Lock and return the visible documents among `ids`, or refuse. Meant for write transactions:
 * the row locks keep the targets stable until commit.
 */
export async function assertVisibleDocuments(trx: DbOrTrx, vis: Visibility, ids: string[]): Promise<VisibleDocument[]> {
    const unique = Array.from(new Set(ids));
    const found = await visibleDocuments(trx, vis)
        .select(['documents.id', 'documents.original_filename', 'documents.folder_id'])
        .where('documents.id', 'in', unique)
        .orderBy('documents.id')
        .forUpdate()
        .execute();
    const foundIds = new Set(found.map((row) => row.id));
    const missing = unique.filter((id) => !foundIds.has(id));

    if (missing.length > 0) throw new ToolError(toNotFoundMessage(missing));

    return found;
}

/** Lock and return a visible folder, or refuse with the same message as for an unknown id. */
export async function assertVisibleFolder(trx: DbOrTrx, vis: Visibility, id: string): Promise<Folder> {
    const folder = await visibleFolders(trx, vis).selectAll('folders').where('folders.id', '=', id).forUpdate().executeTakeFirst();

    if (!folder) throw new ToolError('Folder not found: ' + id);

    return folder;
}

/** Non-locking variant for read tools. */
export async function fetchVisibleFolder(vis: Visibility, id: string): Promise<Folder> {
    const folder = await visibleFolders(db, vis).selectAll('folders').where('folders.id', '=', id).executeTakeFirst();

    if (!folder) throw new ToolError('Folder not found: ' + id);

    return folder;
}

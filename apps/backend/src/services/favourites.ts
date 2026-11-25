import type { Favourite, FavouriteLocation, FavouriteType } from '@reverie/shared';
import { db } from '../db/kysely.js';
import type { Favourite as DbFavourite, Folder as DbFolder } from '../db/schema.js';
import { TAKEN_AT_SQL } from './document-list-filters.js';
import { serializeDocument } from './document-serializer.js';
import type { FolderLocks } from './folder-locks.js';
import { serializeFolder } from './folder-serializer.js';
import { loadFolderTree } from './folders/load.js';
import { EMPTY_ROLLUP, loadFolderRollups, type FolderRollup } from './folders/rollup.js';
import type { FolderTree } from './folders/snapshot.js';
import { excludeTrashed } from './privacy.js';

const ID_COLUMN = { document: 'document_id', folder: 'folder_id' } as const;

/** Star an item the caller has already found and may open. A repeat keeps the first `starred_at`. */
export async function addFavourite(userId: string, type: FavouriteType, id: string): Promise<void> {
    await db
        .insertInto('favourites')
        .values({ user_id: userId, document_id: type === 'document' ? id : null, folder_id: type === 'folder' ? id : null })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
}

export async function removeFavourite(userId: string, type: FavouriteType, id: string): Promise<void> {
    await db.deleteFrom('favourites').where('user_id', '=', userId).where(ID_COLUMN[type], '=', id).execute();
}

/**
 * The folder whose lock covers an item the user owns, trashed or not: a folder is its own, a document's is
 * the folder it sits in. Null when there is none, or the user owns no such item.
 */
export async function fetchLockFolderId(userId: string, type: FavouriteType, id: string): Promise<string | null> {
    if (type === 'folder') {
        const folder = await db.selectFrom('folders').select('id').where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();

        return folder?.id ?? null;
    }

    const document = await db.selectFrom('documents').select('folder_id').where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();

    return document?.folder_id ?? null;
}

function fetchLiveDocuments(userId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);

    const query = db.selectFrom('documents').selectAll().select(TAKEN_AT_SQL.as('taken_at')).where('user_id', '=', userId).where('id', 'in', ids);

    return excludeTrashed(query, '').execute();
}

/** What the items of one list are built from. */
interface ListContext {
    locks: FolderLocks;
    tree: FolderTree<DbFolder>;
    documents: Map<string, Awaited<ReturnType<typeof fetchLiveDocuments>>[number]>;
    rollups: Map<string, FolderRollup>;
}

async function loadListContext(userId: string, stars: DbFavourite[], locks: FolderLocks): Promise<ListContext> {
    const documentIds = stars.flatMap((star) => star.document_id ?? []);
    const [tree, documentRows] = await Promise.all([loadFolderTree(userId), fetchLiveDocuments(userId, documentIds)]);
    // Only public folders are described, so only they are counted and covered.
    const shown = stars.flatMap((star) => star.folder_id ?? []).filter((id) => !locks.isPrivate(id));
    const rollups = await loadFolderRollups(userId, tree, shown, locks);

    return { locks, tree, documents: new Map(documentRows.map((document) => [document.id, document])), rollups };
}

/** The live folders from the top level down to `folderId`, itself included. */
function toLocation(folderId: string | null, tree: ListContext['tree']): FavouriteLocation[] {
    const folder = folderId === null ? undefined : tree.folder(folderId);

    if (!folder) return [];

    return [...tree.ancestors(folder.id), folder].filter((step) => step.deleted_at === null).map(({ id, name }) => ({ id, name }));
}

/** A private item, built from nothing but its star and its lock: no name, location or payload. */
function toPrivateFavourite(base: Pick<Favourite, 'type' | 'id' | 'starred_at'>, lockFolderId: string, locks: FolderLocks): Favourite {
    return {
        ...base,
        private: true,
        locked: locks.isLocked(lockFolderId),
        lock_id: locks.lockIdOf(lockFolderId),
        location: null,
        folder: null,
        document: null,
    };
}

const PUBLIC_FLAGS = { private: false, locked: false, lock_id: null } as const;

function toFolderFavourite(star: DbFavourite, folderId: string, context: ListContext): Favourite | null {
    const folder = context.tree.folder(folderId);

    if (!folder || folder.deleted_at !== null) return null;

    const base = { type: 'folder', id: folder.id, starred_at: star.starred_at.toISOString() } as const;

    if (context.locks.isPrivate(folder.id)) return toPrivateFavourite(base, folder.id, context.locks);

    const { document_count, cover } = context.rollups.get(folder.id) ?? EMPTY_ROLLUP;

    return {
        ...base,
        ...PUBLIC_FLAGS,
        location: toLocation(folder.parent_id, context.tree),
        folder: { ...serializeFolder(folder, context.locks), document_count, cover },
        document: null,
    };
}

async function toDocumentFavourite(star: DbFavourite, documentId: string, context: ListContext): Promise<Favourite | null> {
    const document = context.documents.get(documentId);

    if (!document) return null;

    const base = { type: 'document', id: document.id, starred_at: star.starred_at.toISOString() } as const;

    if (document.folder_id !== null && context.locks.isPrivate(document.folder_id)) {
        return toPrivateFavourite(base, document.folder_id, context.locks);
    }

    return {
        ...base,
        ...PUBLIC_FLAGS,
        location: toLocation(document.folder_id, context.tree),
        folder: null,
        document: await serializeDocument(document, context.locks),
    };
}

/** Every favourite that is not in the trash, newest-starred first. */
export async function listFavourites(userId: string, locks: FolderLocks): Promise<Favourite[]> {
    const stars = await db.selectFrom('favourites').selectAll().where('user_id', '=', userId).orderBy('starred_at', 'desc').orderBy('id', 'desc').execute();

    if (stars.length === 0) return [];

    const context = await loadListContext(userId, stars, locks);
    const items = await Promise.all(
        stars.map((star) =>
            star.folder_id !== null ? toFolderFavourite(star, star.folder_id, context) : toDocumentFavourite(star, star.document_id!, context),
        ),
    );

    return items.filter((item) => item !== null);
}

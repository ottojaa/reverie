import type { Kysely } from 'kysely';
import { db } from '../db/kysely.js';
import type { Database } from '../db/schema.js';

/**
 * Which folders are private, worked out at query time (nothing is denormalized).
 *
 * A document has no privacy of its own: it is private exactly when its folder is. A folder is
 * private when it is flagged itself or sits in a private collection. The hierarchy is two levels
 * (collection -> folder), so one extra lookup covers the whole cascade.
 *
 * Each private folder belongs to one lock: the private collection when there is one, otherwise the
 * folder itself. Opening a lock (see folder-locks.ts) opens every folder that maps to it.
 */

/** Folder id -> id of the lock that covers it, for every private folder of a user. Trash is ignored on purpose: a trashed private folder stays private. */
export type LockMap = ReadonlyMap<string, string>;

export async function loadLockMap(userId: string, conn: Kysely<Database> = db): Promise<LockMap> {
    const roots = await conn.selectFrom('folders').select('id').where('user_id', '=', userId).where('is_private', '=', true).execute();

    if (roots.length === 0) return new Map();

    const ownLocks = roots.map((root): [string, string] => [root.id, root.id]);
    const children = await conn
        .selectFrom('folders')
        .select(['id', 'parent_id'])
        .where('user_id', '=', userId)
        .where(
            'parent_id',
            'in',
            roots.map((root) => root.id),
        )
        .execute();
    // A folder in a private collection is covered by the collection's lock, even if it is flagged too.
    const inheritedLocks = children.map((child): [string, string] => [child.id, child.parent_id!]);

    return new Map([...ownLocks, ...inheritedLocks]);
}

/** Ids of every private folder (collections included) of a user. */
export async function getPrivateFolderIds(userId: string): Promise<string[]> {
    return Array.from((await loadLockMap(userId)).keys());
}

/** Whether a stored document sits in a private folder. For callers with no lock state at hand, such as background workers. */
export async function isDocumentPrivate(doc: { user_id: string; folder_id: string | null }): Promise<boolean> {
    if (doc.folder_id === null) return false;

    return (await loadLockMap(doc.user_id)).has(doc.folder_id);
}

// The heterogeneous Kysely query builders across search/facets/suggest don't share a
// single type, so these helpers stay loosely typed (matching the existing `as any`
// style in query-builder.ts). They only ever append `.where(...)` clauses.

/**
 * Append the privacy exclusion to a document-scoped query so private documents never
 * surface. `prefix` is the documents alias with a trailing dot: 'd.' for the joined
 * search queries, '' for a bare selectFrom('documents').
 */
export function excludePrivateDocuments<T>(query: T, privateFolderIds: string[], prefix: 'd.' | '' = 'd.'): T {
    if (privateFolderIds.length === 0) return query;

    return (query as any).where((eb: any) => eb.or([eb(`${prefix}folder_id`, 'is', null), eb(`${prefix}folder_id`, 'not in', privateFolderIds)])) as T;
}

/** Exclude private folders from a folders-scoped query (bare or aliased id column). */
export function excludePrivateFolders<T>(query: T, privateFolderIds: string[], idColumn = 'id'): T {
    if (privateFolderIds.length === 0) return query;

    return (query as any).where(idColumn, 'not in', privateFolderIds) as T;
}

/**
 * Hide trashed rows from a documents- or folders-scoped query. `prefix` is the table alias with a
 * trailing dot ('d.', 'f.') or '' for a bare selectFrom. Not part of the privacy helpers: a trashed
 * item in a private folder is still locked, so loadLockMap deliberately ignores trash.
 */
export function excludeTrashed<T>(query: T, prefix: string): T {
    return (query as any).where(`${prefix}deleted_at`, 'is', null) as T;
}

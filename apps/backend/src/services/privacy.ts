import { db } from '../db/kysely';

/**
 * Privacy helpers shared across search, folder listing and document listing.
 *
 * Effective privacy is derived at query time (no denormalization): a document is
 * private if its own is_private flag is set OR it lives in an effectively-private
 * folder. A folder is effectively private if its own flag is set OR its parent
 * collection is private. Because the hierarchy is exactly two levels
 * (collection -> folder), one extra lookup covers the whole cascade.
 */

/**
 * All folder ids that are effectively private for a user. Cheap: the private set is
 * typically a small fraction of a user's folders and is backed by a partial index.
 */
export async function getPrivateFolderIds(userId: string): Promise<string[]> {
    const roots = await db.selectFrom('folders').select('id').where('user_id', '=', userId).where('is_private', '=', true).execute();

    const rootIds = roots.map((r) => r.id);

    if (rootIds.length === 0) return [];

    // Child folders of a private collection inherit its privacy.
    const children = await db.selectFrom('folders').select('id').where('user_id', '=', userId).where('parent_id', 'in', rootIds).execute();

    return Array.from(new Set([...rootIds, ...children.map((r) => r.id)]));
}

// The heterogeneous Kysely query builders across search/facets/suggest don't share a
// single type, so these helpers stay loosely typed (matching the existing `as any`
// style in query-builder.ts). They only ever append `.where(...)` clauses.

/**
 * Append the privacy exclusion to a document-scoped query so private items never
 * surface. `prefix` is the documents alias with a trailing dot: 'd.' for the joined
 * search queries, '' for a bare selectFrom('documents').
 */
export function excludePrivateDocuments<T>(query: T, privateFolderIds: string[], prefix: 'd.' | '' = 'd.'): T {
    let next = (query as any).where(`${prefix}is_private`, '=', false);

    if (privateFolderIds.length > 0) {
        next = next.where((eb: any) => eb.or([eb(`${prefix}folder_id`, 'is', null), eb(`${prefix}folder_id`, 'not in', privateFolderIds)]));
    }

    return next as T;
}

/** Exclude effectively-private folders from a folders-scoped query (bare or aliased id column). */
export function excludePrivateFolders<T>(query: T, privateFolderIds: string[], idColumn = 'id'): T {
    if (privateFolderIds.length === 0) return query;

    return (query as any).where(idColumn, 'not in', privateFolderIds) as T;
}

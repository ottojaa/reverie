import { createHash } from 'node:crypto';
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { env } from '../config/env';
import { db } from '../db/kysely';
import { clusterCompleteLinkage, type Cluster, type SimilarPair } from './clustering';

/**
 * Builds the duplicate groups from the stored pairs when they are asked for. Nothing about a group is stored, so trash, restore, a move into
 * a private folder and "not duplicates" take effect on the next read without any invalidation.
 *
 * Which pairs count: both images are the owner's, live (not trashed), in the same partition, and the pair is not dismissed.
 * The partition is "outside every private folder" or "inside one lock" (a private folder, or a private collection with all its
 * folders), so a private image is grouped only with images behind the same lock and never shows up outside it.
 */

export interface DuplicateScope {
    userId: string;
    /** Every private folder of the owner, locked or not. */
    privateFolderIds: string[];
    /** The folders behind one lock: groups are built among images in them. Null: images outside every private folder. */
    lockFolderIds: string[] | null;
}

export interface DuplicateCluster extends Cluster {
    /** A hash of the member ids: a group that gains or loses a member gets a new id. */
    id: string;
}

export function toGroupId(ids: string[]): string {
    return createHash('sha1')
        .update([...ids].sort().join(','))
        .digest('hex')
        .slice(0, 24);
}

/** The partition rule for one side of a pair, `alias` being `a` or `b`. */
function inPartition(alias: 'a' | 'b', scope: DuplicateScope): RawBuilder<SqlBool> {
    const folder = sql.ref(`${alias}.folder_id`);

    if (scope.lockFolderIds) {
        return scope.lockFolderIds.length > 0 ? sql<SqlBool>`${folder} IN (${sql.join(scope.lockFolderIds)})` : sql<SqlBool>`false`;
    }

    if (scope.privateFolderIds.length === 0) return sql<SqlBool>`true`;

    return sql<SqlBool>`(${folder} IS NULL OR ${folder} NOT IN (${sql.join(scope.privateFolderIds)}))`;
}

/** Pairs the embedding scans stored, at or above the current threshold. */
async function loadNearPairs(scope: DuplicateScope): Promise<SimilarPair[]> {
    const rows = await db
        .selectFrom('duplicate_edges as e')
        .innerJoin('documents as a', 'a.id', 'e.doc_a')
        .innerJoin('documents as b', 'b.id', 'e.doc_b')
        .select(['e.doc_a', 'e.doc_b', 'e.similarity'])
        .where('a.user_id', '=', scope.userId)
        .where('b.user_id', '=', scope.userId)
        .where('a.deleted_at', 'is', null)
        .where('b.deleted_at', 'is', null)
        .where('e.similarity', '>=', env.DUPLICATE_MIN_SIMILARITY)
        .where(inPartition('a', scope))
        .where(inPartition('b', scope))
        .execute();

    return rows.map((row) => ({ a: row.doc_a, b: row.doc_b, similarity: row.similarity }));
}

/** Pairs of images with the same file hash. They need no embedding, so they are found here and not by the scan. */
export async function loadExactPairs(scope: DuplicateScope): Promise<SimilarPair[]> {
    const rows = await db
        .selectFrom('documents as a')
        .innerJoin('documents as b', (join) => join.onRef('b.file_hash', '=', 'a.file_hash').on(sql<boolean>`a.id < b.id`))
        .select(['a.id as doc_a', 'b.id as doc_b'])
        .where('a.user_id', '=', scope.userId)
        .where('b.user_id', '=', scope.userId)
        .where('a.deleted_at', 'is', null)
        .where('b.deleted_at', 'is', null)
        .where('a.mime_type', 'like', 'image/%')
        .where('b.mime_type', 'like', 'image/%')
        .where(inPartition('a', scope))
        .where(inPartition('b', scope))
        .execute();

    return rows.map((row) => ({ a: row.doc_a, b: row.doc_b, similarity: 1 }));
}

async function loadDismissedPairs(userId: string): Promise<Set<string>> {
    const rows = await db.selectFrom('duplicate_dismissals').select(['doc_a', 'doc_b']).where('user_id', '=', userId).execute();

    return new Set(rows.map((row) => row.doc_a + ':' + row.doc_b));
}

/** Every duplicate group in the scope, biggest first. */
export async function loadDuplicateClusters(scope: DuplicateScope): Promise<DuplicateCluster[]> {
    const [near, exact, dismissed] = await Promise.all([loadNearPairs(scope), loadExactPairs(scope), loadDismissedPairs(scope.userId)]);
    const pairs = [...near, ...exact].filter((pair) => {
        const [lo, hi] = pair.a < pair.b ? [pair.a, pair.b] : [pair.b, pair.a];

        return !dismissed.has(lo + ':' + hi);
    });

    return clusterCompleteLinkage(pairs).map((cluster) => ({ ...cluster, id: toGroupId(cluster.ids) }));
}

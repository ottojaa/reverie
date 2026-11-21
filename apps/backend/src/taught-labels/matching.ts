import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { excludePrivateDocuments } from '../services/privacy';

/**
 * Which images look like a label's examples, by image-embedding similarity.
 *
 * An image matches when its best cosine similarity to any single example reaches the threshold (nearest example,
 * not an average: one label can cover several looks). Only vectors from the same model and version are compared.
 * The scan is exact (an HNSW index serves nearest-k, not "everything above a cutoff") so a count shown before
 * applying equals what applying does; the library is one person's, so one pass over it is cheap.
 */

type Conn = Kysely<Database>;

/** Initial threshold when the examples give no spread to learn from (a single example, or none comparable). */
export const DEFAULT_THRESHOLD = 0.85;
/** The initial threshold never goes below this, so one outlier example can't loosen the label. */
export const MIN_INITIAL_THRESHOLD = 0.7;
export const MAX_INITIAL_THRESHOLD = 0.95;
/** Lowest threshold the user can pick; the similarity list for the manager starts here. */
export const MIN_THRESHOLD = 0.5;

export interface Candidate {
    documentId: string;
    /** Best cosine similarity to any example. */
    similarity: number;
}

export interface CandidateOptions {
    minSimilarity: number;
    /** Leave out images that are themselves examples. */
    excludeExamples?: boolean;
    /** When set, images in these folders are left out: what the owner sees (search ignores private folders too). Unset: every live image. */
    hidePrivateFolders?: string[];
    limit?: number;
}

/**
 * Live images of the label's owner whose similarity to the label's examples reaches `minSimilarity`, most similar first.
 * Examples that are trashed don't teach anything; images on the label's exclusion list never come back.
 */
export async function findCandidates(conn: Conn, label: { id: string; user_id: string }, options: CandidateOptions): Promise<Candidate[]> {
    const similarity = sql<number>`max(1 - (e.embedding <=> x.embedding))`;
    let query = conn
        .selectFrom('document_image_embeddings as e')
        .innerJoin('documents as d', 'd.id', 'e.document_id')
        .innerJoin('taught_label_examples as ex', (join) => join.onTrue())
        .innerJoin('documents as xd', 'xd.id', 'ex.document_id')
        .innerJoin('document_image_embeddings as x', (join) =>
            join.onRef('x.document_id', '=', 'ex.document_id').onRef('x.model', '=', 'e.model').onRef('x.model_version', '=', 'e.model_version'),
        )
        .select(['e.document_id', similarity.as('similarity')])
        .where('ex.label_id', '=', label.id)
        .where('d.user_id', '=', label.user_id)
        .where('d.deleted_at', 'is', null)
        .where('xd.deleted_at', 'is', null)
        .where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('taught_label_exclusions as nx')
                        .select('nx.document_id')
                        .whereRef('nx.document_id', '=', 'e.document_id')
                        .where('nx.label_id', '=', label.id),
                ),
            ),
        )
        .groupBy('e.document_id')
        .having(sql<boolean>`max(1 - (e.embedding <=> x.embedding)) >= ${options.minSimilarity}`)
        .orderBy('similarity', 'desc')
        .orderBy('e.document_id');

    if (options.hidePrivateFolders) query = excludePrivateDocuments(query, options.hidePrivateFolders, 'd.');

    if (options.excludeExamples) {
        query = query.where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('taught_label_examples as me')
                        .select('me.document_id')
                        .whereRef('me.document_id', '=', 'e.document_id')
                        .where('me.label_id', '=', label.id),
                ),
            ),
        );
    }

    if (options.limit) query = query.limit(options.limit);

    const rows = await query.execute();

    return rows.map((row) => ({ documentId: row.document_id, similarity: Number(row.similarity) }));
}

/**
 * Starting threshold for a label: the median, over its examples, of the similarity to the nearest other example,
 * clamped to a sensible band. The median (not the loosest example) keeps one odd example from pulling the
 * threshold down for all of them.
 */
export async function computeInitialThreshold(conn: Conn, labelId: string): Promise<number> {
    const rows = await conn
        .selectFrom('taught_label_examples as ex')
        .innerJoin('documents as d', 'd.id', 'ex.document_id')
        .innerJoin('document_image_embeddings as a', 'a.document_id', 'ex.document_id')
        .innerJoin('taught_label_examples as ox', (join) => join.onRef('ox.label_id', '=', 'ex.label_id').onRef('ox.document_id', '!=', 'ex.document_id'))
        .innerJoin('documents as od', 'od.id', 'ox.document_id')
        .innerJoin('document_image_embeddings as b', (join) =>
            join.onRef('b.document_id', '=', 'ox.document_id').onRef('b.model', '=', 'a.model').onRef('b.model_version', '=', 'a.model_version'),
        )
        .select(['ex.document_id', sql<number>`max(1 - (a.embedding <=> b.embedding))`.as('sibling')])
        .where('ex.label_id', '=', labelId)
        .where('d.deleted_at', 'is', null)
        .where('od.deleted_at', 'is', null)
        .groupBy('ex.document_id')
        .execute();

    if (rows.length === 0) return DEFAULT_THRESHOLD;

    const sorted = rows.map((row) => Number(row.sibling)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;

    return roundThreshold(Math.min(MAX_INITIAL_THRESHOLD, Math.max(MIN_INITIAL_THRESHOLD, median)));
}

/** Two decimals: what the slider shows and what is stored. */
export function roundThreshold(value: number): number {
    return Math.round(value * 100) / 100;
}

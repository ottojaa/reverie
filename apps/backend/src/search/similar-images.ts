import type { ParsedQuery } from '@reverie/shared';
import { sql } from 'kysely';
import { db } from '../db/kysely';
import { applySearchFilters, documentJoins, type SearchQueryBase } from './filter-application';
import { parseQuery } from './query-parser';
import { executeNearest } from './semantic-rank';

/**
 * "Find images like this": the images nearest to a document's own image embedding.
 *
 * The source's stored embedding is the query, so no ML service is involved and this works with it off.
 * Candidates come from the same filtered documents query as search (the owner's, outside private folders,
 * not trashed), and only from the model and version the source was embedded with: vectors from different
 * models can't be compared. No similarity floor: the caller asked for "the nearest", so a page is
 * always filled while the library has images.
 */

export interface SimilarImage {
    id: string;
    /** Cosine similarity to the source, 1 for identical. */
    similarity: number;
}

export interface SimilarImages {
    entries: SimilarImage[];
    /** Images that could be listed in all, the source excluded. */
    total: number;
}

export interface SimilarImagesOptions {
    limit: number;
    offset: number;
    /** The documents query candidates are drawn from; defaults to all documents. The agent's search passes a guarded one. */
    base?: SearchQueryBase;
    /** Filters (folder, date, tag...) the images must also satisfy; free text is ignored. */
    filters?: ParsedQuery;
}

interface SourceEmbedding {
    literal: string;
    model: string;
    version: string;
}

async function loadSourceEmbedding(documentId: string): Promise<SourceEmbedding | null> {
    const row = await db
        .selectFrom('document_image_embeddings')
        .select([sql<string>`embedding::text`.as('literal'), 'model', 'model_version'])
        .where('document_id', '=', documentId)
        .executeTakeFirst();

    return row ? { literal: row.literal, model: row.model, version: row.model_version } : null;
}

function candidatesOf(source: SourceEmbedding, documentId: string, userId: string, privateFolderIds: string[], base: SearchQueryBase, filters: ParsedQuery) {
    return applySearchFilters(base, filters, userId, privateFolderIds)
        .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
        .where('e.model', '=', source.model)
        .where('e.model_version', '=', source.version)
        .where('d.id', '!=', documentId);
}

/** Nearest images to `documentId`'s own, or null when that document has no image embedding yet. */
export async function findSimilarImages(
    userId: string,
    privateFolderIds: string[],
    documentId: string,
    options: SimilarImagesOptions,
): Promise<SimilarImages | null> {
    const source = await loadSourceEmbedding(documentId);

    if (!source) return null;

    const base = options.base ?? documentJoins();
    const filters = { ...(options.filters ?? parseQuery('')), fullText: undefined };
    const distance = sql<number>`e.embedding <=> ${source.literal}::vector`;
    const [rows, counted] = await Promise.all([
        executeNearest(
            candidatesOf(source, documentId, userId, privateFolderIds, base, filters)
                .select(['d.id', distance.as('distance')])
                .orderBy('distance')
                .orderBy('d.id')
                .limit(options.offset + options.limit),
        ),
        candidatesOf(source, documentId, userId, privateFolderIds, base, filters)
            .select(sql<number>`count(*)::int`.as('count'))
            .executeTakeFirstOrThrow(),
    ]);
    // Iterative index scans return rows only roughly in order, so order the page again.
    const entries = rows
        .map((row) => ({ id: row.id, similarity: 1 - Number(row.distance) }))
        .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
        .slice(options.offset, options.offset + options.limit);

    return { entries, total: counted.count };
}

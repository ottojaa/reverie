import { sql, type Kysely } from 'kysely';
import { env } from '../config/env';
import { db } from '../db/kysely';
import type { Database } from '../db/schema';
import { executeNearest } from '../search/semantic-rank';

/**
 * Finds the images that look nearly the same as one image and stores each such pair once (`duplicate_edges`).
 *
 * The scan reads the image's own stored embedding, so it needs no ML service. Candidates are the owner's other images embedded by the same
 * model and version. Trashed and private images are not left out: they change after the scan (trash, restore, a move into a private
 * folder), and a pair missing because of a state that later reverts would never come back. Reading the groups filters them instead.
 *
 * Exact copies (the same file hash) are not stored here: reading the groups finds them from `documents.file_hash`, which needs no embedding.
 */

export interface ScanConfig {
    /** Cosine similarity two images must reach to be stored as a pair. */
    minSimilarity: number;
    /** Most pairs stored per scan: the nearest neighbours only. */
    maxNeighbours: number;
}

export function loadScanConfig(): ScanConfig {
    return { minSimilarity: env.DUPLICATE_MIN_SIMILARITY, maxNeighbours: env.DUPLICATE_MAX_NEIGHBOURS };
}

export interface ScanSource {
    userId: string;
    literal: string;
    model: string;
    version: string;
}

export async function loadScanSource(conn: Kysely<Database>, documentId: string): Promise<ScanSource | null> {
    const row = await conn
        .selectFrom('document_image_embeddings as e')
        .innerJoin('documents as d', 'd.id', 'e.document_id')
        .select(['d.user_id', sql<string>`e.embedding::text`.as('literal'), 'e.model', 'e.model_version'])
        .where('e.document_id', '=', documentId)
        .executeTakeFirst();

    return row ? { userId: row.user_id, literal: row.literal, model: row.model, version: row.model_version } : null;
}

export async function findNeighbours(source: ScanSource, documentId: string, config: ScanConfig): Promise<Array<{ id: string; similarity: number }>> {
    const distance = sql<number>`e.embedding <=> ${source.literal}::vector`;
    const rows = await executeNearest(
        db
            .selectFrom('document_image_embeddings as e')
            .innerJoin('documents as d', 'd.id', 'e.document_id')
            .select(['d.id', distance.as('distance')])
            .where('d.user_id', '=', source.userId)
            .where('d.id', '!=', documentId)
            .where('e.model', '=', source.model)
            .where('e.model_version', '=', source.version)
            // Distance alone, and no similarity cutoff here: either one would stop the planner from reading the HNSW index in distance order.
            .orderBy('distance')
            .limit(config.maxNeighbours),
    );

    return rows.map((row) => ({ id: row.id, similarity: 1 - Number(row.distance) })).filter((row) => row.similarity >= config.minSimilarity);
}

/**
 * Replaces the stored pairs of one image with its current near neighbours and records the scan, in one transaction.
 * Returns the number of pairs stored, or null when the image has no embedding (yet), which stores nothing.
 */
export async function scanDuplicates(documentId: string, config: ScanConfig = loadScanConfig()): Promise<number | null> {
    const source = await loadScanSource(db, documentId);

    if (!source) return null;

    const neighbours = await findNeighbours(source, documentId, config);

    await db.transaction().execute(async (trx) => {
        await trx
            .deleteFrom('duplicate_edges')
            .where((eb) => eb.or([eb('doc_a', '=', documentId), eb('doc_b', '=', documentId)]))
            .execute();

        if (neighbours.length > 0) {
            // uuid order in Postgres is the byte order, which is the order of the lowercase hex text.
            const pairs = neighbours.map((n) => ({
                doc_a: documentId < n.id ? documentId : n.id,
                doc_b: documentId < n.id ? n.id : documentId,
                similarity: n.similarity,
            }));

            await trx
                .insertInto('duplicate_edges')
                .values(pairs)
                .onConflict((oc) => oc.columns(['doc_a', 'doc_b']).doUpdateSet((eb) => ({ similarity: eb.ref('excluded.similarity') })))
                .execute();
        }

        await trx
            .insertInto('document_duplicate_scans')
            .values({ document_id: documentId, threshold: config.minSimilarity, scanned_at: new Date() })
            .onConflict((oc) => oc.column('document_id').doUpdateSet({ threshold: config.minSimilarity, scanned_at: new Date() }))
            .execute();
    });

    return neighbours.length;
}

/**
 * Images with an embedding that were never scanned (trashed ones too: a restore must find their pairs ready), or scanned at a higher threshold than `minSimilarity` (they lack pairs between
 * the two). Used by the embed backfill; `after` pages by id.
 */
export async function findImagesToScan(conn: Kysely<Database>, minSimilarity: number, after: string | null, limit: number): Promise<string[]> {
    const rows = await conn
        .selectFrom('documents as d')
        .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
        .leftJoin('document_duplicate_scans as s', 's.document_id', 'd.id')
        .select('d.id')
        .$if(after !== null, (qb) => qb.where('d.id', '>', after!))
        .where((eb) => eb.or([eb('s.document_id', 'is', null), eb('s.threshold', '>', minSimilarity)]))
        .orderBy('d.id')
        .limit(limit)
        .execute();

    return rows.map((row) => row.id);
}

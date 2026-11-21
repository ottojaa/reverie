import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';

export interface ModelRef {
    model: string;
    version: string;
}

/** pgvector's input form for a vector parameter. */
export function toVectorLiteral(vector: number[]): string {
    return '[' + vector.join(',') + ']';
}

/** The text a document is embedded from: the LLM summary, a blank line, then the OCR text. Null when both are empty. */
export async function loadEmbeddableText(db: Kysely<Database>, documentId: string): Promise<{ exists: boolean; text: string | null }> {
    const row = await db
        .selectFrom('documents as d')
        .leftJoin('ocr_results as o', 'o.document_id', 'd.id')
        .leftJoin('llm_results as l', 'l.document_id', 'd.id')
        .select(['d.id', 'o.raw_text as ocr_text', 'l.summary'])
        .where('d.id', '=', documentId)
        .executeTakeFirst();

    if (!row) return { exists: false, text: null };

    const parts = [row.summary, row.ocr_text].map((part) => part?.trim() ?? '').filter(Boolean);

    return { exists: true, text: parts.length ? parts.join('\n\n') : null };
}

/** True when the document already has text embeddings that are all for this exact text and model. */
export async function hasCurrentTextEmbeddings(db: Kysely<Database>, documentId: string, hash: string, current: ModelRef): Promise<boolean> {
    const rows = await db
        .selectFrom('document_text_embeddings')
        .select(sql<boolean>`bool_and(content_hash = ${hash} AND model = ${current.model} AND model_version = ${current.version})`.as('current'))
        .where('document_id', '=', documentId)
        .executeTakeFirst();

    return rows?.current === true;
}

export interface TextChunkEmbedding {
    index: number;
    start: number;
    end: number;
    embedding: number[];
}

/** Replaces all of a document's text chunks in one transaction, so readers never see a mix of old and new. */
export async function replaceTextEmbeddings(
    db: Kysely<Database>,
    documentId: string,
    hash: string,
    current: ModelRef,
    chunks: TextChunkEmbedding[],
): Promise<void> {
    await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('document_text_embeddings').where('document_id', '=', documentId).execute();

        if (!chunks.length) return;

        await trx
            .insertInto('document_text_embeddings')
            .values(
                chunks.map((chunk) => ({
                    document_id: documentId,
                    chunk_index: chunk.index,
                    char_start: chunk.start,
                    char_end: chunk.end,
                    content_hash: hash,
                    model: current.model,
                    model_version: current.version,
                    embedding: toVectorLiteral(chunk.embedding),
                })),
            )
            .execute();
    });
}

export async function deleteTextEmbeddings(db: Kysely<Database>, documentId: string): Promise<void> {
    await db.deleteFrom('document_text_embeddings').where('document_id', '=', documentId).execute();
}

/** True when the stored image embedding is for exactly this rendition (by hash) and the current model. */
export async function hasCurrentImageEmbedding(db: Kysely<Database>, documentId: string, hash: string, current: ModelRef): Promise<boolean> {
    const row = await db
        .selectFrom('document_image_embeddings')
        .select('document_id')
        .where('document_id', '=', documentId)
        .where('content_hash', '=', hash)
        .where('model', '=', current.model)
        .where('model_version', '=', current.version)
        .executeTakeFirst();

    return row !== undefined;
}

export async function upsertImageEmbedding(db: Kysely<Database>, documentId: string, hash: string, current: ModelRef, embedding: number[]): Promise<void> {
    const values = { content_hash: hash, model: current.model, model_version: current.version, embedding: toVectorLiteral(embedding) };

    await db
        .insertInto('document_image_embeddings')
        .values({ document_id: documentId, ...values })
        .onConflict((oc) => oc.column('document_id').doUpdateSet(values))
        .execute();
}

export async function loadImageSource(db: Kysely<Database>, documentId: string): Promise<{ exists: boolean; thumbnailPath: string | null; isImage: boolean }> {
    const row = await db.selectFrom('documents').select(['mime_type', 'thumbnail_paths']).where('id', '=', documentId).executeTakeFirst();

    if (!row) return { exists: false, thumbnailPath: null, isImage: false };

    return { exists: true, isImage: row.mime_type.startsWith('image/'), thumbnailPath: row.thumbnail_paths?.sm ?? null };
}

/** Live documents with text but no text embeddings for the current model, in id order, after `after`. */
export async function findDocumentsMissingTextEmbeddings(db: Kysely<Database>, current: ModelRef, after: string | null, limit: number): Promise<string[]> {
    const rows = await db
        .selectFrom('documents as d')
        .select('d.id')
        .where('d.deleted_at', 'is', null)
        .$if(after !== null, (qb) => qb.where('d.id', '>', after!))
        .where((eb) =>
            eb.or([
                eb.exists(
                    eb
                        .selectFrom('ocr_results as o')
                        .select('o.id')
                        .whereRef('o.document_id', '=', 'd.id')
                        .where(sql<boolean>`btrim(o.raw_text) <> ''`),
                ),
                eb.exists(
                    eb
                        .selectFrom('llm_results as l')
                        .select('l.id')
                        .whereRef('l.document_id', '=', 'd.id')
                        .where(sql<boolean>`btrim(coalesce(l.summary, '')) <> ''`),
                ),
            ]),
        )
        .where((eb) =>
            eb.not(
                eb.exists(
                    eb
                        .selectFrom('document_text_embeddings as e')
                        .select('e.id')
                        .whereRef('e.document_id', '=', 'd.id')
                        .where('e.model', '=', current.model)
                        .where('e.model_version', '=', current.version),
                ),
            ),
        )
        .orderBy('d.id')
        .limit(limit)
        .execute();

    return rows.map((row) => row.id);
}

/** Live image documents with a thumbnail rendition but no image embedding for the current model. */
export async function findDocumentsMissingImageEmbeddings(db: Kysely<Database>, current: ModelRef, after: string | null, limit: number): Promise<string[]> {
    const rows = await db
        .selectFrom('documents as d')
        .select('d.id')
        .where('d.deleted_at', 'is', null)
        .where('d.mime_type', 'like', 'image/%')
        .where('d.thumbnail_paths', 'is not', null)
        .$if(after !== null, (qb) => qb.where('d.id', '>', after!))
        .where((eb) =>
            eb.not(
                eb.exists(
                    eb
                        .selectFrom('document_image_embeddings as e')
                        .select('e.document_id')
                        .whereRef('e.document_id', '=', 'd.id')
                        .where('e.model', '=', current.model)
                        .where('e.model_version', '=', current.version),
                ),
            ),
        )
        .orderBy('d.id')
        .limit(limit)
        .execute();

    return rows.map((row) => row.id);
}

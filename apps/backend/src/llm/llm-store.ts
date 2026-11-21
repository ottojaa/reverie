/**
 * Writes of an LLM result: the llm_results row and the document's auto tags. Shared by the text summary and the
 * image call, which store the same shape.
 */
import type { Entity } from '@reverie/shared';
import { db } from '../db/kysely';
import { sanitizeTags } from './tag-sanitizer';

/** Upsert an LLM result for a document. */
export async function upsertLlmResult(
    documentId: string,
    data: { summary: string | null; metadata: unknown; token_count: number | null; processing_type: string },
): Promise<void> {
    await db
        .insertInto('llm_results')
        .values({
            document_id: documentId,
            summary: data.summary,
            metadata: data.metadata as any,
            token_count: data.token_count,
            processing_type: data.processing_type,
        })
        .onConflict((oc) =>
            oc.column('document_id').doUpdateSet({
                summary: data.summary,
                metadata: data.metadata as any,
                token_count: data.token_count,
                processing_type: data.processing_type,
            }),
        )
        .execute();
}

/**
 * Replace the document's auto-generated tags with a freshly sanitized set.
 *
 * This is the only writer of document_tags. Deleting existing source='auto' tags
 * before inserting new ones fixes tag accumulation across reprocesses; user tags
 * (source='user') are preserved and used as dedup targets. Tag candidates are the
 * LLM's proposed tags, with topics/entity names as fallbacks (see sanitizeTags).
 */
export async function updateSearchIndex(documentId: string, analysis: { tags: string[]; topics: string[]; entities: Entity[] }): Promise<void> {
    await db.transaction().execute(async (trx) => {
        const userTags = await trx.selectFrom('document_tags').select('tag').where('document_id', '=', documentId).where('source', '=', 'user').execute();

        const tags = sanitizeTags({
            proposedTags: analysis.tags,
            topics: analysis.topics,
            entities: analysis.entities,
            existingTags: userTags.map((t) => t.tag),
        });

        await trx.deleteFrom('document_tags').where('document_id', '=', documentId).where('source', '=', 'auto').execute();

        if (tags.length === 0) {
            return;
        }

        await trx
            .insertInto('document_tags')
            .values(tags.map((tag) => ({ document_id: documentId, tag, source: 'auto' as const })))
            .onConflict((oc) => oc.columns(['document_id', 'tag']).doNothing())
            .execute();
    });
}

/**
 * A failed run marks the document failed, unless it already has a summary: a backfill run that fails leaves the
 * earlier summary in place, and the document keeps showing it as complete.
 */
export async function markLlmFailed(documentId: string): Promise<void> {
    const existing = await db.selectFrom('llm_results').select('summary').where('document_id', '=', documentId).executeTakeFirst();
    const status = existing?.summary ? 'complete' : 'failed';

    await db.updateTable('documents').set({ llm_status: status }).where('id', '=', documentId).execute();
}

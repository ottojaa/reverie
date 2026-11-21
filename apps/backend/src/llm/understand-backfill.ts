/**
 * Backfill of the image call over images that were summarised before it existed (screenshots and document images
 * with a text summary or none). Paged by id like the other backfill stages, so it resumes from its cursor; each page is
 * small and the next one waits until the LLM queue drains, which is what rate-limits it.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { isDocumentPrivate } from '../services/privacy';
import { withholdsImageContentSql } from '../tools/photo';
import type { AddLlmJob } from '../image-kind/llm-trigger';
import { decideImageLook, LOOK_KINDS } from './image-look';

/** Images per page: the call is a few tenths of a cent, but a library should not become a burst of requests. */
export const UNDERSTAND_PAGE_SIZE = 5;

/** A job that failed this recently is not tried again by the backfill: a refusal or a bad file would fail again. */
const RETRY_FAILED_AFTER_HOURS = 24;

/**
 * Live images the classifier calls a screenshot, document, receipt or diagram, without camera evidence, that have no
 * image summary yet and no LLM job running or recently failed. Photos are excluded here and again when the job runs.
 */
export async function findImagesToUnderstand(db: Kysely<Database>, after: string | null, limit: number): Promise<string[]> {
    const rows = await db
        .selectFrom('documents as d')
        .innerJoin('document_image_kinds as k', 'k.document_id', 'd.id')
        .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
        .leftJoin('llm_results as r', 'r.document_id', 'd.id')
        .select('d.id')
        .where('d.deleted_at', 'is', null)
        .where('d.mime_type', 'like', 'image/%')
        .where('k.kind', 'in', [...LOOK_KINDS])
        .where(sql<boolean>`NOT ${withholdsImageContentSql()}`)
        .where((eb) => eb.or([eb('r.document_id', 'is', null), eb('r.processing_type', '<>', 'image_understanding'), eb('r.summary', 'is', null)]))
        .where(
            sql<boolean>`NOT EXISTS (
                SELECT 1 FROM processing_jobs j
                WHERE j.target_id = d.id AND j.job_type = 'llm_summary'
                  AND (j.status IN ('pending', 'processing')
                       OR (j.status = 'failed' AND j.created_at > now() - make_interval(hours => ${RETRY_FAILED_AFTER_HOURS})))
            )`,
        )
        .$if(after !== null, (qb) => qb.where('d.id', '>', after!))
        .orderBy('d.id')
        .limit(limit)
        .execute();

    return rows.map((row) => row.id);
}

export type UnderstandOutcome = 'queued' | 'skipped';

/**
 * Queues the LLM job for one image, after the same checks the worker makes (private, trashed, photo gate), so a
 * document that would only be skipped does not take a queue slot. The document's llm_status is left alone: an existing
 * summary stays shown as complete while the new one is made, and the worker sets the status as it runs.
 */
export async function queueUnderstanding(db: Kysely<Database>, addLlmJob: AddLlmJob, documentId: string): Promise<UnderstandOutcome> {
    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();

    if (!document || document.deleted_at || (await isDocumentPrivate(document))) return 'skipped';

    const look = await decideImageLook(document);

    if (!look.call) return 'skipped';

    const job = await db
        .insertInto('processing_jobs')
        .values({ user_id: document.user_id, job_type: 'llm_summary', target_type: 'document', target_id: documentId, status: 'pending' })
        .returning('id')
        .executeTakeFirstOrThrow();

    await addLlmJob({ documentId, userId: document.user_id }, job.id);

    return 'queued';
}

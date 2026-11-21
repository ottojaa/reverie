import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { toLookKindFromVerdict } from '../llm/image-look';
import { isVisionSwitchedOn } from '../llm/provider-config';
import { shouldSkipLlmProcessing } from '../ocr/text-detector';
import type { LlmJobData } from '../queues/llm.queue';
import { isCameraBacked } from '../tools/photo';
import type { ImageKind } from './kinds';

export type AddLlmJob = (data: LlmJobData, jobId: string) => Promise<void>;

export type LlmTriggerOutcome = 'queued' | 'skipped' | 'not-ready' | 'already-queued';

interface Candidate {
    userId: string;
    hasText: boolean;
    confidence: number | null;
    hasCameraFacts: boolean;
}

/**
 * A screenshot, document, receipt or diagram with no camera facts gets the image call whatever its OCR text says
 * (the call reads the pixels, so empty or poor OCR is no reason to skip it); it needs the "model sees images" switch on (`vision`). Anything else gets a
 * text summary when its text clears the OCR thresholds, as when the OCR worker queues the job, and otherwise nothing:
 * a photo is never sent. The LLM worker decides again when the job runs (decideImageLook).
 */
function wantsLlmJob(candidate: Candidate, kind: ImageKind, vision: boolean): boolean {
    if (vision && toLookKindFromVerdict(kind) !== null && !candidate.hasCameraFacts) return true;

    return !shouldSkipLlmProcessing(candidate.confidence ?? 0, candidate.hasText);
}

/**
 * The embed side of the flipped LLM trigger: queues the image's LLM job once its verdict is known and OCR has
 * finished storing its text flag and EXIF (the `ocr_facts_at` marker). Runs under a per-document advisory lock so
 * two embed workers finishing together queue once. An LLM job newer than the OCR run counts as already queued,
 * so a reprocess (a new OCR run, a newer marker) is summarised again and a replay is not.
 */
export async function queueLlmAfterKind(db: Kysely<Database>, addLlmJob: AddLlmJob, documentId: string, kind: ImageKind): Promise<LlmTriggerOutcome> {
    // The admin's setting, read before the lock so the transaction stays short.
    const vision = await isVisionSwitchedOn();
    const claim = await db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${'image-kind-llm:' + documentId}))`.execute(trx);

        const row = await trx
            .selectFrom('documents as d')
            .leftJoin('ocr_results as o', 'o.document_id', 'd.id')
            .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
            .select([
                'd.user_id',
                'd.ocr_facts_at',
                'd.camera_read_at',
                'd.has_meaningful_text',
                'o.confidence_score',
                'pm.taken_at',
                'pm.latitude',
                'pm.longitude',
                'pm.camera_make',
                'pm.camera_model',
                'pm.lens_model',
            ])
            .where('d.id', '=', documentId)
            .where('d.deleted_at', 'is', null)
            .executeTakeFirst();

        if (!row?.ocr_facts_at) return { outcome: 'not-ready' as const };

        const latest = await trx
            .selectFrom('processing_jobs')
            .select(['status', 'created_at'])
            .where('target_id', '=', documentId)
            .where('job_type', '=', 'llm_summary')
            .orderBy('created_at', 'desc')
            .executeTakeFirst();

        if (latest && (latest.created_at >= row.ocr_facts_at || latest.status === 'pending' || latest.status === 'processing')) {
            return { outcome: 'already-queued' as const };
        }

        const candidate: Candidate = {
            userId: row.user_id,
            hasText: row.has_meaningful_text,
            confidence: row.confidence_score,
            hasCameraFacts: isCameraBacked(row),
        };

        if (!wantsLlmJob(candidate, kind, vision)) {
            await trx.updateTable('documents').set({ llm_status: 'skipped' }).where('id', '=', documentId).execute();

            return { outcome: 'skipped' as const };
        }

        await trx.updateTable('documents').set({ llm_status: 'pending' }).where('id', '=', documentId).execute();

        const job = await trx
            .insertInto('processing_jobs')
            .values({ user_id: candidate.userId, job_type: 'llm_summary', target_type: 'document', target_id: documentId, status: 'pending' })
            .returning('id')
            .executeTakeFirstOrThrow();

        return { outcome: 'queued' as const, jobId: job.id, userId: candidate.userId };
    });

    if (claim.outcome !== 'queued') return claim.outcome;

    await addLlmJob({ documentId, userId: claim.userId }, claim.jobId);

    return 'queued';
}

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { getLlmQueue } from '../queues/llm.queue';
import { getOcrQueue } from '../queues/ocr.queue';
import { getThumbnailQueue } from '../queues/thumbnail.queue';
import { LIVE_JOB_STATUSES, toLiveJobCutoff } from './queue-transcode';
import { isQueuesBusy } from '../queues/backfill-gate';
import { getBackgroundTranscodeQueue, getTranscodeQueue } from '../queues/transcode.queue';

export type TranscodeBackfillStep = { kind: 'next'; after: string } | { kind: 'wait' } | { kind: 'done' };

export interface TranscodeBackfillDeps {
    db: Kysely<Database>;
    /** True while thumbnails, OCR, summaries or other transcodes have work, so the backfill leaves the machine to them. */
    isBusy: () => Promise<boolean>;
    enqueue: (documentId: string, userId: string) => Promise<boolean>;
    batchSize: number;
}

/** Videos still waiting for their ladder: not trashed (a restore makes them eligible again) and with no job already in line, in id order. */
export async function findVideosToTranscode(db: Kysely<Database>, after: string | null, limit: number): Promise<Array<{ id: string; user_id: string }>> {
    return db
        .selectFrom('documents')
        .select(['id', 'user_id'])
        .where('mime_type', 'like', 'video/%')
        .where('transcode_status', '=', 'pending')
        .where('deleted_at', 'is', null)
        .where((eb) =>
            eb.not(
                eb.exists(
                    eb
                        .selectFrom('processing_jobs')
                        .select('processing_jobs.id')
                        .whereRef('processing_jobs.target_id', '=', 'documents.id')
                        .where('processing_jobs.job_type', '=', 'transcode')
                        .where('processing_jobs.status', 'in', LIVE_JOB_STATUSES)
                        .where('processing_jobs.created_at', '>', toLiveJobCutoff()),
                ),
            ),
        )
        .$if(after !== null, (query) => query.where('id', '>', after!))
        .orderBy('id')
        .limit(limit)
        .execute();
}

/**
 * One page of the backfill: queue the next `batchSize` videos that lack renditions. Stateless apart from the cursor: a
 * restart asks the database again, and a video with a job in line or a finished set no longer matches. A video whose job
 * ran out of retries is 'failed', not 'pending', so it is not retried forever.
 */
export async function runTranscodeBackfillPage(deps: TranscodeBackfillDeps, after: string | null): Promise<TranscodeBackfillStep> {
    if (await deps.isBusy()) return { kind: 'wait' };

    const page = await findVideosToTranscode(deps.db, after, deps.batchSize);

    if (page.length === 0) return { kind: 'done' };

    for (const document of page) await deps.enqueue(document.id, document.user_id);

    return { kind: 'next', after: page[page.length - 1]!.id };
}

/** Thumbnails, OCR, summaries and other transcodes come first: the backfill waits while any has work. */
export async function isTranscodePipelineBusy(): Promise<boolean> {
    return isQueuesBusy([getOcrQueue(), getThumbnailQueue(), getLlmQueue(), getBackgroundTranscodeQueue()], getTranscodeQueue());
}

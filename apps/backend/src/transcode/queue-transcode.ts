import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { addTranscodeJob } from '../queues/transcode.queue';
import { setTranscodeStatus } from './repository';

type AddJob = typeof addTranscodeJob;

/** A pending or processing job older than this is a leftover (a Redis that lost its queue), not work in line. */
export const LIVE_JOB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function hasLiveTranscodeJob(db: Kysely<Database>, documentId: string): Promise<boolean> {
    const row = await db
        .selectFrom('processing_jobs')
        .select('id')
        .where('job_type', '=', 'transcode')
        .where('target_id', '=', documentId)
        .where('status', 'in', ['pending', 'processing'])
        .where('created_at', '>', new Date(Date.now() - LIVE_JOB_MAX_AGE_MS))
        .limit(1)
        .executeTakeFirst();

    return row !== undefined;
}

/**
 * Queues one video's transcode: a processing_jobs row (its id is the queue job's id, which is how the worker's tracking finds
 * it), the pending status, and the job. A video that already has a live job is left alone. Best effort and never throws: the
 * thumbnail step calls it, and a Redis hiccup here must not fail the thumbnail. A video that misses its job stays
 * 'pending', which is what the backfill looks for. Returns whether a job was queued.
 */
export async function queueTranscode(
    db: Kysely<Database>,
    documentId: string,
    userId: string,
    priority?: number,
    add: AddJob = addTranscodeJob,
): Promise<boolean> {
    try {
        if (await hasLiveTranscodeJob(db, documentId)) return false;

        const job = await db
            .insertInto('processing_jobs')
            .values({ user_id: userId, job_type: 'transcode', target_type: 'document', target_id: documentId, status: 'pending', priority: priority ?? 0 })
            .returning('id')
            .executeTakeFirstOrThrow();

        await setTranscodeStatus(db, documentId, 'pending');
        await add({ documentId, userId }, job.id, priority);

        return true;
    } catch (error) {
        console.warn('[Transcode] Could not queue the transcode:', documentId, error instanceof Error ? error.message : String(error));

        return false;
    }
}

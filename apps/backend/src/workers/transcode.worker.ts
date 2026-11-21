import { DelayedError, Job, Worker } from 'bullmq';
import { env } from '../config/env';
import { db } from '../db/kysely';
import { probeVideoFile } from '../media/video-probe';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import { addTranscodeBackfillJob, TRANSCODE_JOBS, type TranscodeBackfillData, type TranscodeJobData } from '../queues/transcode.queue';
import { getStorageService } from '../services/storage.service';
import { isTranscodePipelineBusy, runTranscodeBackfillPage, type TranscodeBackfillStep } from '../transcode/backfill';
import { getCapabilities } from '../transcode/capabilities';
import { queueTranscode } from '../transcode/queue-transcode';
import { setTranscodeStatus } from '../transcode/repository';
import { runFfmpeg } from '../transcode/ffmpeg-run';
import { transcodeDocument, type TranscodeDeps } from '../transcode/service';
import { createWorkerLogger, processJobWithTracking, publishJobProgress } from './worker.utils';

const logger = createWorkerLogger('Transcode');

/** After a pass over the library finds nothing left, look again this often: it catches a video whose job was lost. */
const RECONCILE_MS = 60 * 60 * 1000;

function toDeps(): TranscodeDeps {
    return {
        db,
        storage: getStorageService(),
        capabilities: getCapabilities,
        runFfmpeg,
        probe: probeVideoFile,
    };
}

async function processTranscodeJob(job: Job<TranscodeJobData>): Promise<unknown> {
    const { documentId, userId } = job.data;

    return processJobWithTracking(
        job,
        () => transcodeDocument(toDeps(), documentId, (percent) => publishJobProgress(job.id!, percent, documentId, undefined, userId, 'transcode')),
        { jobType: 'transcode' },
    );
}

async function loadBackfillStep(job: Job<TranscodeBackfillData>): Promise<TranscodeBackfillStep> {
    try {
        return await runTranscodeBackfillPage(
            { db, isBusy: isTranscodePipelineBusy, enqueue: (id, userId) => queueTranscode(db, id, userId, 10), batchSize: env.TRANSCODE_BACKFILL_BATCH },
            job.data.after,
        );
    } catch (error) {
        // A dropped connection becomes a wait: the backfill job is added only at worker start, so failing it would end it until the next deploy.
        logger.error('Transcode backfill page failed, trying again later', error instanceof Error ? error : new Error(String(error)));

        return { kind: 'wait' };
    }
}

/**
 * Moves the backfill job to delayed: for its next page, to wait for quiet queues, or, when a pass is done, to start over
 * after `reconcileMs`. `DelayedError` tells the worker the job was moved on purpose, so it is not completed or failed.
 */
export async function rescheduleTranscodeBackfill(
    job: Pick<Job<TranscodeBackfillData>, 'updateData' | 'moveToDelayed'>,
    step: TranscodeBackfillStep,
    delays: { pageMs: number; reconcileMs: number },
    token: string | undefined,
): Promise<never> {
    if (step.kind === 'next') await job.updateData({ after: step.after });

    if (step.kind === 'done') await job.updateData({ after: null });

    await job.moveToDelayed(Date.now() + (step.kind === 'done' ? delays.reconcileMs : delays.pageMs), token);

    throw new DelayedError();
}

async function processBackfill(job: Job<TranscodeBackfillData>, token: string | undefined): Promise<never> {
    const step = await loadBackfillStep(job);

    if (step.kind === 'done') logger.info('Transcode backfill pass finished');

    return rescheduleTranscodeBackfill(job, step, { pageMs: env.TRANSCODE_BACKFILL_INTERVAL_MS, reconcileMs: RECONCILE_MS }, token);
}

/** Once the retries are used up the video is 'failed'; its original is untouched and stays playable. */
export async function markFailedWhenFinal(job: Job<TranscodeJobData> | undefined, error: Error): Promise<void> {
    if (!job || job.name !== TRANSCODE_JOBS.TRANSCODE) return;

    const isFinal = job.attemptsMade >= (job.opts.attempts ?? 1) || error.name === 'NonRetryableJobError';

    if (!isFinal) return;

    await setTranscodeStatus(db, job.data.documentId, 'failed').catch((statusError: unknown) => {
        logger.error('Could not mark the transcode failed', statusError instanceof Error ? statusError : new Error(String(statusError)), {
            documentId: job.data.documentId,
        });
    });
}

export function createTranscodeWorker(): Worker<TranscodeJobData | TranscodeBackfillData> {
    const worker = new Worker<TranscodeJobData | TranscodeBackfillData>(
        QUEUE_NAMES.TRANSCODE,
        (job, token) =>
            job.name === TRANSCODE_JOBS.BACKFILL
                ? processBackfill(job as Job<TranscodeBackfillData>, token)
                : processTranscodeJob(job as Job<TranscodeJobData>),
        { connection: getRedisConnectionOptions(), concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.TRANSCODE] },
    );

    worker.on('failed', (job, error) => {
        logger.error('Transcode job failed', error, { jobId: job?.id, name: job?.name });
        void markFailedWhenFinal(job as Job<TranscodeJobData> | undefined, error);
    });

    worker.on('error', (error) => {
        logger.error('Worker error', error);
    });

    // Detected once and logged, before the first job needs it.
    void getCapabilities();

    addTranscodeBackfillJob().catch((error: unknown) => {
        logger.error('Failed to queue the transcode backfill', error instanceof Error ? error : new Error(String(error)));
    });

    logger.info('Transcode worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.TRANSCODE] });

    return worker;
}

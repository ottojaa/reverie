import { Job, Worker, type Processor } from 'bullmq';
import { env } from '../config/env';
import { db } from '../db/kysely';
import { getJobService } from '../jobs/job.service';
import { probeVideoFile } from '../media/video-probe';
import { delayBackfillJob } from '../queues/backfill-gate';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import { addTranscodeBackfillJob, TRANSCODE_JOBS, type TranscodeBackfillData, type TranscodeJobData } from '../queues/transcode.queue';
import { getStorageService } from '../services/storage.service';
import { isTranscodePipelineBusy, runTranscodeBackfillPage, type TranscodeBackfillStep } from '../transcode/backfill';
import { getCapabilities } from '../transcode/capabilities';
import { queueTranscode } from '../transcode/queue-transcode';
import { setTranscodeStatus } from '../transcode/repository';
import { createFfmpegRunner, runFfmpeg } from '../transcode/ffmpeg-run';
import { transcodeDocument, type TranscodeDeps } from '../transcode/service';
import { createWorkerLogger, processJobWithTracking, publishJobProgress } from './worker.utils';

const logger = createWorkerLogger('Transcode');

/** After a pass over the library finds nothing left, look again this often: it catches a video whose job was lost. */
const RECONCILE_MS = 60 * 60 * 1000;

type TranscodeQueueName = typeof QUEUE_NAMES.TRANSCODE | typeof QUEUE_NAMES.TRANSCODE_BACKGROUND;

function toDeps(): TranscodeDeps {
    return {
        db,
        storage: getStorageService(),
        capabilities: getCapabilities,
        runFfmpeg,
        probe: probeVideoFile,
    };
}

/** A background encode yields the CPU to everything else on the server and keeps to a few threads. */
function toBackgroundDeps(): TranscodeDeps {
    return { ...toDeps(), runFfmpeg: createFfmpegRunner(env.TRANSCODE_BACKGROUND_NICE), threads: env.TRANSCODE_BACKGROUND_THREADS };
}

/** True on the final try of a job that has more than one (`attemptsMade` counts the tries already used up). */
export function isLastAttempt(job: Pick<Job, 'attemptsMade' | 'opts'>): boolean {
    const attempts = job.opts.attempts ?? 1;

    return attempts > 1 && job.attemptsMade >= attempts - 1;
}

async function processTranscodeJob(job: Job<TranscodeJobData>, deps: TranscodeDeps): Promise<unknown> {
    const { documentId, userId } = job.data;

    // On the last of several attempts the encode takes the plain CPU path (see `TranscodeOptions.safeMode`).
    const safeMode = isLastAttempt(job);

    return processJobWithTracking(
        job,
        () =>
            transcodeDocument(deps, documentId, (percent) => publishJobProgress(job.id!, percent, documentId, undefined, userId, 'transcode'), {
                safeMode,
            }),
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
    const nextData = step.kind === 'next' ? { after: step.after } : step.kind === 'done' ? { after: null } : null;

    return delayBackfillJob(job, nextData, step.kind === 'done' ? delays.reconcileMs : delays.pageMs, token);
}

async function processBackfill(job: Job<TranscodeBackfillData>, token: string | undefined): Promise<never> {
    const step = await loadBackfillStep(job);

    if (step.kind === 'done') logger.info('Transcode backfill pass finished');

    return rescheduleTranscodeBackfill(job, step, { pageMs: env.TRANSCODE_BACKFILL_INTERVAL_MS, reconcileMs: RECONCILE_MS }, token);
}

/**
 * Once the retries are used up the video is 'failed'; its original is untouched and stays playable. BullMQ also gives up
 * on a job that stalled more than once (the worker was killed mid-encode by deploys): that failure arrives with fewer
 * attempts counted than allowed, so `finishedOn` (set only when the job is done for good) is what says it is final.
 */
export async function markFailedWhenFinal(job: Job<TranscodeJobData> | undefined, error: Error): Promise<void> {
    if (!job || job.name !== TRANSCODE_JOBS.TRANSCODE) return;

    const attempts = job.opts.attempts ?? 1;
    const isNonRetryable = error.name === 'NonRetryableJobError';
    const isFinal = job.finishedOn !== undefined || job.attemptsMade >= attempts || isNonRetryable;

    if (!isFinal) return;

    // A stalled job never reached the tracking wrapper's catch, so its processing_jobs row is still live and would block a re-queue.
    const gaveUpEarly = job.finishedOn !== undefined && job.attemptsMade < attempts;

    if (gaveUpEarly && job.id)
        await getJobService()
            .markJobFailed(job.id, error.message, job.attemptsMade)
            .catch((rowError: unknown) => {
                logger.error('Could not mark the transcode job row failed', rowError instanceof Error ? rowError : new Error(String(rowError)), {
                    documentId: job.data.documentId,
                    jobId: job.id,
                });
            });

    await setTranscodeStatus(db, job.data.documentId, 'failed').catch((statusError: unknown) => {
        logger.error('Could not mark the transcode failed', statusError instanceof Error ? statusError : new Error(String(statusError)), {
            documentId: job.data.documentId,
        });
    });
}

function startWorker(queueName: TranscodeQueueName, processor: Processor<TranscodeJobData | TranscodeBackfillData>) {
    const concurrency = QUEUE_CONCURRENCY[queueName];
    const worker = new Worker(queueName, processor, { connection: getRedisConnectionOptions(), concurrency });

    worker.on('failed', (job, error) => {
        logger.error('Transcode job failed', error, { jobId: job?.id, name: job?.name });
        void markFailedWhenFinal(job as Job<TranscodeJobData> | undefined, error);
    });

    worker.on('error', (error) => {
        logger.error('Worker error', error);
    });

    logger.info('Transcode worker started', { queue: queueName, concurrency });

    return worker;
}

export function createTranscodeWorker(): Worker<TranscodeJobData | TranscodeBackfillData> {
    const worker = startWorker(QUEUE_NAMES.TRANSCODE, (job, token) =>
        job.name === TRANSCODE_JOBS.BACKFILL
            ? processBackfill(job as Job<TranscodeBackfillData>, token)
            : processTranscodeJob(job as Job<TranscodeJobData>, toDeps()),
    );

    // Detected once and logged, before the first job needs it.
    void getCapabilities();

    addTranscodeBackfillJob().catch((error: unknown) => {
        logger.error('Failed to queue the transcode backfill', error instanceof Error ? error : new Error(String(error)));
    });

    return worker;
}

/** The background lane's own slot: it runs beside the normal worker, so a long background encode holds no normal video up. */
export function createBackgroundTranscodeWorker(): Worker<TranscodeJobData | TranscodeBackfillData> {
    return startWorker(QUEUE_NAMES.TRANSCODE_BACKGROUND, (job) => processTranscodeJob(job as Job<TranscodeJobData>, toBackgroundDeps()));
}

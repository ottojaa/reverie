import { DelayedError, Job, UnrecoverableError, Worker } from 'bullmq';
import { env } from '../config/env';
import { db } from '../db/kysely';
import { isPipelineBusy, runBackfillPage, type BackfillStep } from '../embeddings/backfill';
import { embedDocumentImage, embedDocumentText, type EmbedDeps } from '../embeddings/embedding.service';
import { MlRejectedError, getMlClient, type MlClient } from '../embeddings/ml.client';
import { addEmbedBackfillJob, addEmbedJob, BACKFILL_PRIORITY, EMBED_JOBS, type EmbedBackfillData, type EmbedJobData } from '../queues/embed.queue';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import { getStorageService } from '../services/storage.service';
import { createWorkerLogger } from './worker.utils';

const logger = createWorkerLogger('Embed');

type EmbedJob = Job<EmbedJobData | EmbedBackfillData>;

/**
 * Embedding is internal bookkeeping, so it is not tracked in processing_jobs and publishes no job events.
 * Failures retry through the queue's own backoff; the OCR, summary and thumbnail workers never wait on it.
 */
async function processEmbedJob(job: EmbedJob, ml: MlClient, token: string | undefined): Promise<unknown> {
    if (job.name === EMBED_JOBS.BACKFILL) return processBackfill(job as Job<EmbedBackfillData>, ml, token);

    const deps: EmbedDeps = { db, ml, readFile: (path) => getStorageService().readFile(path) };

    return runEmbedJob(deps, job.name, (job.data as EmbedJobData).documentId);
}

/** One embed-text or embed-image job. A refusal from reverie-ml (an undecodable image) is final; everything else retries. */
export async function runEmbedJob(deps: EmbedDeps, name: string, documentId: string): Promise<unknown> {
    try {
        return name === EMBED_JOBS.IMAGE ? await embedDocumentImage(deps, documentId) : await embedDocumentText(deps, documentId);
    } catch (error) {
        // An undecodable image will never decode: stop retrying it.
        if (error instanceof MlRejectedError) throw new UnrecoverableError(error.message);

        throw error;
    }
}

/**
 * A backfill job reschedules itself rather than adding a successor: BullMQ drops an add whose job id still exists.
 * `DelayedError` tells the worker the job was moved to delayed on purpose, so it is not completed or failed.
 */
async function processBackfill(job: Job<EmbedBackfillData>, ml: MlClient, token: string | undefined): Promise<void> {
    const step = await loadBackfillStep(job, ml);

    if (step.kind === 'done') logger.info('Embedding backfill finished');

    await rescheduleBackfill(job, step, env.EMBED_BACKFILL_INTERVAL_MS, token);
}

/**
 * Any error while paging (a dropped DB connection, or migration 017 not applied yet on the first deploy) becomes a
 * wait: the backfill job is added only at worker start, so letting it fail would end it until the next deploy.
 */
async function loadBackfillStep(job: Job<EmbedBackfillData>, ml: MlClient): Promise<BackfillStep> {
    try {
        return await runBackfillPage(
            {
                db,
                ml,
                isBusy: isPipelineBusy,
                enqueue: (kind, id) => addEmbedJob(kind, id, BACKFILL_PRIORITY),
                batchSize: env.EMBED_BACKFILL_BATCH,
            },
            job.data.cursor,
        );
    } catch (error) {
        logger.error('Embedding backfill page failed, trying again later', error instanceof Error ? error : new Error(String(error)));

        return { kind: 'wait', reason: 'error' };
    }
}

/** Moves a backfill job to delayed for its next page (or to wait for ML / quiet queues). Returns normally only when done. */
export async function rescheduleBackfill(
    job: Pick<Job<EmbedBackfillData>, 'updateData' | 'moveToDelayed'>,
    step: BackfillStep,
    intervalMs: number,
    token: string | undefined,
): Promise<void> {
    if (step.kind === 'done') return;

    if (step.kind === 'next') await job.updateData({ cursor: step.cursor });

    await job.moveToDelayed(Date.now() + intervalMs, token);

    throw new DelayedError();
}

/** Start the embed worker, and queue the backfill so a library that predates embeddings catches up. */
export function createEmbedWorker(ml: MlClient): Worker<EmbedJobData | EmbedBackfillData> {
    const worker = new Worker<EmbedJobData | EmbedBackfillData>(QUEUE_NAMES.EMBED, (job, token) => processEmbedJob(job, ml, token), {
        connection: getRedisConnectionOptions(),
        concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.EMBED],
    });

    worker.on('failed', (job, error) => {
        logger.error('Embed job failed', error, { jobId: job?.id, name: job?.name });
    });

    worker.on('error', (error) => {
        logger.error('Worker error', error);
    });

    addEmbedBackfillJob().catch((error: unknown) => {
        logger.error('Failed to queue the embedding backfill', error instanceof Error ? error : new Error(String(error)));
    });

    logger.info('Embed worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.EMBED] });

    return worker;
}

export function startEmbedWorker(): Worker<EmbedJobData | EmbedBackfillData> | null {
    const ml = getMlClient();

    if (!ml) {
        logger.info('ML_URL is not set: embeddings are off');

        return null;
    }

    return createEmbedWorker(ml);
}

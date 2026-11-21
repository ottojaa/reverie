import { DelayedError, Job, UnrecoverableError, Worker } from 'bullmq';
import { access } from 'fs/promises';
import { env } from '../config/env';
import { db } from '../db/kysely';
import { readDocumentMedia } from '../media/media-read';
import { probeVideoFile, toVideoExtension, type VideoProbe } from '../media/video-probe';
import { isPipelineBusy, runBackfillPage, type BackfillStep } from '../embeddings/backfill';
import { embedDocumentImage, embedDocumentText, type EmbedDeps } from '../embeddings/embedding.service';
import { isKindFlipActive, settleImageKind } from '../image-kind/service';
import { MlRejectedError, getMlClient, type MlClient } from '../embeddings/ml.client';
import {
    addEmbedBackfillJob,
    addEmbedJob,
    BACKFILL_PRIORITY,
    EMBED_JOBS,
    type EmbedBackfillData,
    type EmbedBackfillCursor,
    type EmbedJobData,
} from '../queues/embed.queue';
import { isVisionAvailable } from '../llm/anthropic.client';
import { queueUnderstanding } from '../llm/understand-backfill';
import { addLlmJob } from '../queues/llm.queue';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import { getStorageService } from '../services/storage.service';
import { createWorkerLogger } from './worker.utils';

const logger = createWorkerLogger('Embed');

type EmbedJob = Job<EmbedJobData | EmbedBackfillData>;

/** What the embed worker needs beyond embedding: the image-kind step that follows an image embedding or a classify job. */
export interface EmbedWorkerDeps extends EmbedDeps {
    settleKind: (documentId: string) => Promise<unknown>;
    /** Probes a stored video by path, for the read-camera job (which reads a video's facts too). */
    probeVideo: (path: string, mimeType: string) => Promise<VideoProbe>;
}

/** ffprobe on a stored video, through a local path so a video of any size is never read into memory. */
async function probeStoredVideo(path: string, mimeType: string): Promise<VideoProbe> {
    const file = await getStorageService().getLocalFilePath(path, toVideoExtension(mimeType));

    try {
        // ffprobe cannot tell a missing file from a bad one; this throws the ENOENT the caller treats as final.
        await access(file.path);

        return await probeVideoFile(file.path);
    } finally {
        await file.cleanup().catch(() => {});
    }
}

/**
 * Embedding is internal bookkeeping, so it is not tracked in processing_jobs and publishes no job events.
 * Failures retry through the queue's own backoff; the OCR, summary and thumbnail workers never wait on it.
 */
async function processEmbedJob(job: EmbedJob, ml: MlClient, token: string | undefined): Promise<unknown> {
    if (job.name === EMBED_JOBS.BACKFILL) return processBackfill(job as Job<EmbedBackfillData>, ml, token);

    const kindDeps = { db, ml, flip: isKindFlipActive(), addLlmJob };
    const deps: EmbedWorkerDeps = {
        db,
        ml,
        readFile: (path) => getStorageService().readFile(path),
        probeVideo: probeStoredVideo,
        settleKind: (documentId) => settleImageKind(kindDeps, documentId),
    };

    return runEmbedJob(deps, job.name, (job.data as EmbedJobData).documentId);
}

/**
 * One embed-text, embed-image, classify-image or read-camera job. An image job ends by settling the image's kind: classify it and,
 * with the flip on, set its category and queue its LLM job. A refusal from reverie-ml (an undecodable image) is final;
 * everything else retries.
 */
export async function runEmbedJob(deps: EmbedWorkerDeps, name: string, documentId: string): Promise<unknown> {
    try {
        if (name === EMBED_JOBS.TEXT) return await embedDocumentText(deps, documentId);

        if (name === EMBED_JOBS.CLASSIFY) return await deps.settleKind(documentId);

        if (name === EMBED_JOBS.READ_CAMERA) return await readCameraAndSettle(deps, documentId);

        const outcome = await embedDocumentImage(deps, documentId);

        await deps.settleKind(documentId);

        return outcome;
    } catch (error) {
        // An undecodable image will never decode: stop retrying it.
        if (error instanceof MlRejectedError) throw new UnrecoverableError(error.message);

        throw error;
    }
}

/**
 * Fills the media's EXIF or video columns from its file. An image read for the first time is then classified again: the
 * verdict now has the camera facts. One that already had them, and every video, is not.
 */
async function readCameraAndSettle(deps: EmbedWorkerDeps, documentId: string): Promise<unknown> {
    const outcome = await readDocumentMedia(deps, documentId);

    if (outcome === 'read' || outcome === 'no-file') await deps.settleKind(documentId);

    return outcome;
}

/**
 * A backfill job reschedules itself rather than adding a successor: BullMQ drops an add whose job id still exists.
 * `DelayedError` tells the worker the job was moved to delayed on purpose, so it is not completed or failed.
 */
async function processBackfill(job: Job<EmbedBackfillData>, ml: MlClient, token: string | undefined): Promise<void> {
    const step = await loadBackfillStep(job, ml);

    if (step.kind === 'done') logger.info('Embedding backfill pass finished');

    await rescheduleBackfill(job, step, { pageMs: env.EMBED_BACKFILL_INTERVAL_MS, reconcileMs: env.EMBED_RECONCILE_INTERVAL_MS }, token);
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
                ...(isVisionAvailable() && { queueUnderstanding: (id: string) => queueUnderstanding(db, addLlmJob, id) }),
                batchSize: env.EMBED_BACKFILL_BATCH,
            },
            job.data.cursor,
        );
    } catch (error) {
        logger.error('Embedding backfill page failed, trying again later', error instanceof Error ? error : new Error(String(error)));

        return { kind: 'wait', reason: 'error' };
    }
}

export const BACKFILL_START: EmbedBackfillCursor = { stage: 'text', after: null };

/**
 * Moves a backfill job to delayed: for its next page, to wait for ML or quiet queues, or, when a pass over the library
 * is done, to start over after `reconcileMs`. The next pass finds nothing unless an image or text slipped through
 * (an embed job that used up its retries while reverie-ml was down), and then catches it up.
 */
export async function rescheduleBackfill(
    job: Pick<Job<EmbedBackfillData>, 'updateData' | 'moveToDelayed'>,
    step: BackfillStep,
    delays: { pageMs: number; reconcileMs: number },
    token: string | undefined,
): Promise<void> {
    if (step.kind === 'next') await job.updateData({ cursor: step.cursor });

    if (step.kind === 'done') await job.updateData({ cursor: BACKFILL_START });

    await job.moveToDelayed(Date.now() + (step.kind === 'done' ? delays.reconcileMs : delays.pageMs), token);

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

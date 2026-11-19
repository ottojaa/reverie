import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import { scheduleTrashPurge, type TrashPurgeJobResult } from '../queues/trash.queue';
import { getTrashService } from '../services/trash.service';
import { createWorkerLogger } from './worker.utils';

const logger = createWorkerLogger('TrashPurge');

/**
 * Retention purge: removes trashed documents and folders older than `trash.retentionDays`.
 * Files go only through uploadService.deleteDocumentFiles (see TrashService), so a file that
 * another document still uses is kept. Runs on a repeatable job; not tracked in processing_jobs
 * because it has no document or user to attach to.
 */
export function createTrashWorker(): Worker<unknown, TrashPurgeJobResult> {
    const worker = new Worker<unknown, TrashPurgeJobResult>(QUEUE_NAMES.TRASH, async () => getTrashService().purgeExpired(), {
        connection: getRedisConnectionOptions(),
        concurrency: 1,
    });

    worker.on('completed', (job, result) => {
        logger.info('Trash purge completed', { jobId: job.id, documents: result.documents, folders: result.folders });
    });

    worker.on('failed', (job, error) => {
        logger.error('Trash purge failed', error, { jobId: job?.id });
    });

    worker.on('error', (error) => {
        logger.error('Worker error', error);
    });

    scheduleTrashPurge().catch((error: unknown) => {
        logger.error('Failed to schedule trash purge', error instanceof Error ? error : new Error(String(error)));
    });

    logger.info('Trash purge worker started');

    return worker;
}

import { Worker, type Processor, type WorkerOptions } from 'bullmq';
import { QUEUE_CONCURRENCY } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import type { createWorkerLogger } from './worker.utils';

type WorkerLogger = ReturnType<typeof createWorkerLogger>;

interface WorkerSetup {
    /** Names the worker in its start-up log line. */
    label: string;
    logger: WorkerLogger;
    options?: Pick<WorkerOptions, 'stalledInterval' | 'lockDuration'>;
}

/** A started worker on `queueName`, with that queue's configured concurrency. */
export function startWorker<Data, Result>(
    queueName: keyof typeof QUEUE_CONCURRENCY,
    processor: Processor<Data, Result>,
    { label, logger, options }: WorkerSetup,
): Worker<Data, Result> {
    const concurrency = QUEUE_CONCURRENCY[queueName];
    const worker = new Worker<Data, Result>(queueName, processor, { connection: getRedisConnectionOptions(), concurrency, ...options });

    worker.on('error', (error) => {
        logger.error('Worker error', error);
    });

    logger.info(`${label} worker started`, { queue: queueName, concurrency });

    return worker;
}

export function logJobOutcomes<Data, Result>(worker: Worker<Data, Result>, logger: WorkerLogger): void {
    worker.on('completed', (job) => {
        logger.info('Job completed', { jobId: job.id });
    });

    worker.on('failed', (job, error) => {
        logger.error('Job failed', error, { jobId: job?.id });
    });
}

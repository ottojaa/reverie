import { Queue, type JobsOptions } from 'bullmq';
import { fetchLaneJob } from './lane';
import { DEFAULT_JOB_OPTIONS, type QueueName } from './queue.config';
import { getRedisConnectionOptions } from './redis';

/**
 * The two queues of a job type, one per processing lane, each opened on first use. A background document's jobs have a
 * queue and worker of their own, so that a normal document's never waits for a backlog's worker slot.
 */
export function createLaneQueues(normalName: QueueName, backgroundName: QueueName, defaultJobOptions: JobsOptions = DEFAULT_JOB_OPTIONS) {
    let normalQueue: Queue | null = null;
    let backgroundQueue: Queue | null = null;

    function createQueue(name: QueueName): Queue {
        return new Queue(name, { connection: getRedisConnectionOptions(), defaultJobOptions });
    }

    function normal(): Queue {
        normalQueue ??= createQueue(normalName);

        return normalQueue;
    }

    function background(): Queue {
        backgroundQueue ??= createQueue(backgroundName);

        return backgroundQueue;
    }

    /** Adds a document's job to the queue of the lane the document is in. */
    async function add(jobName: string, data: { documentId: string }, options: JobsOptions): Promise<void> {
        const job = await fetchLaneJob(data.documentId, options);
        const queue = job.lane === 'background' ? background() : normal();

        await queue.add(jobName, data, job.options);
    }

    async function close(): Promise<void> {
        await Promise.all([normalQueue?.close(), backgroundQueue?.close()]);
        normalQueue = null;
        backgroundQueue = null;
    }

    return { normal, background, add, close };
}

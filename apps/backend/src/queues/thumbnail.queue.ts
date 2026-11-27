import { Queue } from 'bullmq';
import { fetchLaneJob } from './lane';
import { getRedisConnectionOptions } from './redis';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type QueueName } from './queue.config';

export interface ThumbnailJobData {
    documentId: string;
    /** Document owner; used to route job events to the owner's socket room only. */
    userId: string;
    sessionId?: string;
    filePath: string;
}

export interface ThumbnailJobResult {
    blurhash: string;
    paths: {
        sm: string;
        md: string;
        lg: string;
    };
    originalDimensions: {
        width: number;
        height: number;
    };
}

let thumbnailQueueInstance: Queue | null = null;
let backgroundQueueInstance: Queue | null = null;

function createQueue(name: QueueName): Queue {
    return new Queue(name, { connection: getRedisConnectionOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

export function getThumbnailQueue(): Queue {
    thumbnailQueueInstance ??= createQueue(QUEUE_NAMES.THUMBNAIL);

    return thumbnailQueueInstance;
}

/** Background documents' thumbnails have their own queue, so that a normal document's never waits for a backlog's worker slot. */
export function getBackgroundThumbnailQueue(): Queue {
    backgroundQueueInstance ??= createQueue(QUEUE_NAMES.THUMBNAIL_BACKGROUND);

    return backgroundQueueInstance;
}

export async function addThumbnailJob(data: ThumbnailJobData, jobId: string): Promise<void> {
    const { lane, options } = await fetchLaneJob(data.documentId, { jobId, priority: 10 });
    const queue = lane === 'background' ? getBackgroundThumbnailQueue() : getThumbnailQueue();

    await queue.add('generate-thumbnail', data, options);
}

export async function closeThumbnailQueue(): Promise<void> {
    await Promise.all([thumbnailQueueInstance?.close(), backgroundQueueInstance?.close()]);
    thumbnailQueueInstance = null;
    backgroundQueueInstance = null;
}

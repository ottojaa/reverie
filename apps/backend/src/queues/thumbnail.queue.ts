import { createLaneQueues } from './lane-queues';
import { QUEUE_NAMES } from './queue.config';

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

const queues = createLaneQueues(QUEUE_NAMES.THUMBNAIL, QUEUE_NAMES.THUMBNAIL_BACKGROUND);

export const getThumbnailQueue = queues.normal;
export const getBackgroundThumbnailQueue = queues.background;
export const closeThumbnailQueue = queues.close;

export async function addThumbnailJob(data: ThumbnailJobData, jobId: string): Promise<void> {
    await queues.add('generate-thumbnail', data, { jobId, priority: 10 });
}

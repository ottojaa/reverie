// Redis connections
export { getRedisConnectionOptions, getRedisPublisher, getRedisSubscriber, closeRedisConnections, JOB_EVENTS_CHANNEL } from './redis';

// Queue config
export { QUEUE_NAMES, QUEUE_CONCURRENCY, DEFAULT_JOB_OPTIONS, type QueueName } from './queue.config';

// OCR Queue
export { getOcrQueue, getBackgroundOcrQueue, addOcrJob, closeOcrQueue, type OcrJobData, type OcrJobResult } from './ocr.queue';

// Thumbnail Queue
export {
    getThumbnailQueue,
    getBackgroundThumbnailQueue,
    addThumbnailJob,
    closeThumbnailQueue,
    type ThumbnailJobData,
    type ThumbnailJobResult,
} from './thumbnail.queue';

// LLM Queue
export { getLlmQueue, addLlmJob, closeLlmQueue, type LlmJobData, type LlmJobResult } from './llm.queue';

// Trash purge queue
export { getTrashQueue, scheduleTrashPurge, closeTrashQueue, type TrashPurgeJobResult } from './trash.queue';

// Embed Queue
export { getEmbedQueue, addEmbedJob, addEmbedBackfillJob, closeEmbedQueue, EMBED_JOBS, type EmbedJobData, type EmbedBackfillData } from './embed.queue';

// Transcode Queue
export {
    getTranscodeQueue,
    getBackgroundTranscodeQueue,
    addTranscodeJob,
    addTranscodeBackfillJob,
    closeTranscodeQueue,
    TRANSCODE_JOBS,
    type TranscodeJobData,
    type TranscodeBackfillData,
} from './transcode.queue';

// A document's processing lane
export { promoteToNormal } from './lane';

// Trim Queue
export { getTrimQueue, addTrimJob, closeTrimQueue, type TrimJobData, type TrimJobResult } from './trim.queue';

import { closeOcrQueue } from './ocr.queue';
import { closeThumbnailQueue } from './thumbnail.queue';
import { closeLlmQueue } from './llm.queue';
import { closeTrimQueue } from './trim.queue';
import { closeTrashQueue } from './trash.queue';
import { closeEmbedQueue } from './embed.queue';
import { closeTranscodeQueue } from './transcode.queue';
import { closeRedisConnections } from './redis';

// Close all queues
export async function closeAllQueues(): Promise<void> {
    await Promise.all([
        closeOcrQueue(),
        closeThumbnailQueue(),
        closeLlmQueue(),
        closeTrimQueue(),
        closeTrashQueue(),
        closeEmbedQueue(),
        closeTranscodeQueue(),
        closeRedisConnections(),
    ]);
}

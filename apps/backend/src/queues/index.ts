// Redis connections
export { getRedisConnectionOptions, getRedisPublisher, getRedisSubscriber, closeRedisConnections, JOB_EVENTS_CHANNEL } from './redis'

// Queue config
export { QUEUE_NAMES, QUEUE_CONCURRENCY, DEFAULT_JOB_OPTIONS, type QueueName } from './queue.config'

// OCR Queue
export { getOcrQueue, addOcrJob, closeOcrQueue, type OcrJobData, type OcrJobResult } from './ocr.queue'

// Thumbnail Queue
export { getThumbnailQueue, addThumbnailJob, closeThumbnailQueue, type ThumbnailJobData, type ThumbnailJobResult } from './thumbnail.queue'

// LLM Queue
export { getLlmQueue, addLlmJob, closeLlmQueue, type LlmJobData, type LlmJobResult } from './llm.queue'

import { closeOcrQueue } from './ocr.queue'
import { closeThumbnailQueue } from './thumbnail.queue'
import { closeLlmQueue } from './llm.queue'
import { closeRedisConnections } from './redis'

// Close all queues
export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    closeOcrQueue(),
    closeThumbnailQueue(),
    closeLlmQueue(),
    closeRedisConnections(),
  ])
}

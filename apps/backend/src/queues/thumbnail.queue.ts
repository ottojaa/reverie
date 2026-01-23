import { Queue } from 'bullmq'
import { getRedisConnectionOptions } from './redis'
import { QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from './queue.config'

export interface ThumbnailJobData {
  documentId: string
  sessionId?: string
  filePath: string
}

export interface ThumbnailJobResult {
  blurhash: string
  paths: {
    sm: string
    md: string
    lg: string
  }
  originalDimensions: {
    width: number
    height: number
  }
}

let thumbnailQueueInstance: Queue | null = null

export function getThumbnailQueue(): Queue {
  if (!thumbnailQueueInstance) {
    thumbnailQueueInstance = new Queue(QUEUE_NAMES.THUMBNAIL, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })
  }
  return thumbnailQueueInstance
}

export async function addThumbnailJob(
  data: ThumbnailJobData,
  jobId: string
): Promise<void> {
  const queue = getThumbnailQueue()
  await queue.add('generate-thumbnail', data, {
    jobId,
    priority: 10, // Higher priority than OCR
  })
}

export async function closeThumbnailQueue(): Promise<void> {
  if (thumbnailQueueInstance) {
    await thumbnailQueueInstance.close()
    thumbnailQueueInstance = null
  }
}

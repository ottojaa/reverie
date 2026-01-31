import { Queue } from 'bullmq'
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queue.config'
import { getRedisConnectionOptions } from './redis'
import type { DocumentCategory, ExtractedMetadata } from '../ocr/types'

export interface OcrJobData {
  documentId: string
  sessionId?: string
  filePath: string
  /** Force reprocessing even if already complete */
  forceReprocess?: boolean
}

export interface OcrJobResult {
  rawText: string
  confidence: number
  textDensity: number
  hasMeaningfulText: boolean
  category: DocumentCategory
  needsReview: boolean
  metadata: ExtractedMetadata | null
}

let ocrQueueInstance: Queue | null = null

export function getOcrQueue(): Queue {
  if (!ocrQueueInstance) {
    ocrQueueInstance = new Queue(QUEUE_NAMES.OCR, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })
  }
  return ocrQueueInstance
}

export async function addOcrJob(
  data: OcrJobData,
  jobId: string
): Promise<void> {
  const queue = getOcrQueue()
  await queue.add('process-ocr', data, {
    jobId,
    priority: 0,
  })
}

export async function closeOcrQueue(): Promise<void> {
  if (ocrQueueInstance) {
    await ocrQueueInstance.close()
    ocrQueueInstance = null
  }
}

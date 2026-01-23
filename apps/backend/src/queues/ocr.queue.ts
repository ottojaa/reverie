import { Queue } from 'bullmq'
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queue.config'
import { getRedisConnectionOptions } from './redis'

export interface OcrJobData {
  documentId: string
  sessionId?: string
  filePath: string
}

export interface OcrJobResult {
  rawText: string
  confidence: number
  metadata: Record<string, unknown>
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

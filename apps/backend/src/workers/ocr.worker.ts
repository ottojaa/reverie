import { Worker, Job } from 'bullmq'
import { getRedisConnectionOptions } from '../queues/redis'
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../queues/queue.config'
import type { OcrJobData, OcrJobResult } from '../queues/ocr.queue'
import { processJobWithTracking, createWorkerLogger, publishJobProgress } from './worker.utils'
import { db } from '../db/kysely'
import { NonRetryableJobError } from '../jobs/job.types'

const logger = createWorkerLogger('OCR')

/**
 * Process an OCR job
 * Note: Actual OCR implementation will be added in Plan 5 (OCR Pipeline)
 * This is a placeholder that demonstrates the worker architecture
 */
async function processOcrJob(job: Job<OcrJobData>): Promise<OcrJobResult> {
  const { documentId, filePath } = job.data

  logger.info('Processing OCR job', { documentId, filePath })

  // Verify document exists
  const document = await db
    .selectFrom('documents')
    .selectAll()
    .where('id', '=', documentId)
    .executeTakeFirst()

  if (!document) {
    throw new NonRetryableJobError(`Document ${documentId} not found`)
  }

  // Update progress - starting OCR
  await publishJobProgress(job.id!, 10, documentId, job.data.sessionId)

  // TODO: Implement actual OCR in Plan 5
  // For now, simulate OCR processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  await publishJobProgress(job.id!, 50, documentId, job.data.sessionId)

  // Placeholder result
  const result: OcrJobResult = {
    rawText: `[OCR placeholder for document ${documentId}]`,
    confidence: 0,
    metadata: {
      processedAt: new Date().toISOString(),
      placeholder: true,
    },
  }

  await publishJobProgress(job.id!, 90, documentId, job.data.sessionId)

  // Store OCR result in database
  await db
    .insertInto('ocr_results')
    .values({
      document_id: documentId,
      raw_text: result.rawText,
      confidence_score: result.confidence,
      metadata: result.metadata,
    })
    .execute()

  // Update document OCR status
  await db
    .updateTable('documents')
    .set({ ocr_status: 'complete' })
    .where('id', '=', documentId)
    .execute()

  logger.info('OCR job completed', { documentId })

  return result
}

/**
 * Create and start the OCR worker
 */
export function createOcrWorker(): Worker<OcrJobData, OcrJobResult> {
  const worker = new Worker<OcrJobData, OcrJobResult>(
    QUEUE_NAMES.OCR,
    async (job) => processJobWithTracking(job, processOcrJob),
    {
      connection: getRedisConnectionOptions(),
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.OCR],
    }
  )

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id })
  })

  worker.on('failed', (job, error) => {
    logger.error('Job failed', error, { jobId: job?.id })
  })

  worker.on('error', (error) => {
    logger.error('Worker error', error)
  })

  logger.info('OCR worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.OCR] })

  return worker
}

// Run as standalone if executed directly
if (require.main === module) {
  createOcrWorker()
}


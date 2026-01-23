import { Worker, Job } from 'bullmq'
import { getRedisConnectionOptions } from '../queues/redis'
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../queues/queue.config'
import type { LlmJobData, LlmJobResult } from '../queues/llm.queue'
import { processJobWithTracking, createWorkerLogger, publishJobProgress } from './worker.utils'
import { db } from '../db/kysely'
import { NonRetryableJobError } from '../jobs/job.types'

const logger = createWorkerLogger('LLM')

/**
 * Process an LLM job
 * Note: Actual LLM implementation will be added in Plan 6 (LLM Integration)
 * This is a placeholder that demonstrates the worker architecture
 */
async function processLlmJob(job: Job<LlmJobData>): Promise<LlmJobResult> {
  const { documentId, ocrText } = job.data

  logger.info('Processing LLM job', { documentId, textLength: ocrText.length })

  // Verify document exists
  const document = await db
    .selectFrom('documents')
    .selectAll()
    .where('id', '=', documentId)
    .executeTakeFirst()

  if (!document) {
    throw new NonRetryableJobError(`Document ${documentId} not found`)
  }

  await publishJobProgress(job.id!, 10, documentId, job.data.sessionId)

  // TODO: Implement actual LLM processing in Plan 6
  // For now, return placeholder result
  await new Promise((resolve) => setTimeout(resolve, 100))

  await publishJobProgress(job.id!, 50, documentId, job.data.sessionId)

  // Placeholder result
  const result: LlmJobResult = {
    summary: `[LLM summary placeholder for document ${documentId}]`,
    enhancedMetadata: {
      title: `Document ${documentId}`,
      keyEntities: [],
      topics: [],
      placeholder: true,
    },
    tokenCount: 0,
  }

  await publishJobProgress(job.id!, 90, documentId, job.data.sessionId)

  // Update document with LLM results
  await db
    .updateTable('documents')
    .set({
      llm_summary: result.summary,
      llm_metadata: result.enhancedMetadata,
      llm_processed_at: new Date(),
      llm_token_count: result.tokenCount,
    })
    .where('id', '=', documentId)
    .execute()

  logger.info('LLM job completed', { documentId })

  return result
}

/**
 * Create and start the LLM worker
 */
export function createLlmWorker(): Worker<LlmJobData, LlmJobResult> {
  const worker = new Worker<LlmJobData, LlmJobResult>(
    QUEUE_NAMES.LLM,
    async (job) => processJobWithTracking(job, processLlmJob),
    {
      connection: getRedisConnectionOptions(),
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.LLM],
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

  logger.info('LLM worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.LLM] })

  return worker
}

// Run as standalone if executed directly
if (require.main === module) {
  createLlmWorker()
}


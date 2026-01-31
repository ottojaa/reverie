import type { Job } from 'bullmq'
import { getRedisPublisher, JOB_EVENTS_CHANNEL } from '../queues/redis'
import { getJobService } from '../jobs/job.service'
import type { JobStatus } from '../db/schema'
import { NonRetryableJobError } from '../jobs/job.types'

export interface JobEventPayload {
  type: 'job:started' | 'job:progress' | 'job:complete' | 'job:failed'
  job_id: string
  document_id?: string
  folder_id?: string
  session_id?: string
  status: JobStatus
  progress?: number
  error_message?: string
  result?: unknown
  timestamp: string
}

/**
 * Publish a job event to Redis pub/sub
 */
export async function publishJobEvent(event: JobEventPayload): Promise<void> {
  const publisher = getRedisPublisher()
  await publisher.publish(JOB_EVENTS_CHANNEL, JSON.stringify(event))
}

/**
 * Publish job started event
 */
export async function publishJobStarted(
  jobId: string,
  documentId?: string,
  sessionId?: string
): Promise<void> {
  const event: JobEventPayload = {
    type: 'job:started',
    job_id: jobId,
    status: 'processing',
    progress: 0,
    timestamp: new Date().toISOString(),
  }
  if (documentId) event.document_id = documentId
  if (sessionId) event.session_id = sessionId
  await publishJobEvent(event)
}

/**
 * Publish job progress event
 */
export async function publishJobProgress(
  jobId: string,
  progress: number,
  documentId?: string,
  sessionId?: string
): Promise<void> {
  const event: JobEventPayload = {
    type: 'job:progress',
    job_id: jobId,
    status: 'processing',
    progress,
    timestamp: new Date().toISOString(),
  }
  if (documentId) event.document_id = documentId
  if (sessionId) event.session_id = sessionId
  await publishJobEvent(event)
}

/**
 * Publish job complete event
 */
export async function publishJobComplete(
  jobId: string,
  result?: unknown,
  documentId?: string,
  sessionId?: string
): Promise<void> {
  const event: JobEventPayload = {
    type: 'job:complete',
    job_id: jobId,
    status: 'complete',
    progress: 100,
    timestamp: new Date().toISOString(),
  }
  if (documentId) event.document_id = documentId
  if (sessionId) event.session_id = sessionId
  if (result !== undefined) event.result = result
  await publishJobEvent(event)
}

/**
 * Publish job failed event
 */
export async function publishJobFailed(
  jobId: string,
  errorMessage: string,
  documentId?: string,
  sessionId?: string
): Promise<void> {
  const event: JobEventPayload = {
    type: 'job:failed',
    job_id: jobId,
    status: 'failed',
    progress: 0,
    error_message: errorMessage,
    timestamp: new Date().toISOString(),
  }
  if (documentId) event.document_id = documentId
  if (sessionId) event.session_id = sessionId
  await publishJobEvent(event)
}

/**
 * Base job processor wrapper that handles common logic:
 * - Updates job status in DB
 * - Publishes events to Redis
 * - Handles errors and retries
 */
export async function processJobWithTracking<TData extends { documentId: string; sessionId?: string | undefined }, TResult>(
  job: Job<TData>,
  processor: (job: Job<TData>) => Promise<TResult>
): Promise<TResult> {
  const jobService = getJobService()
  const { documentId, sessionId } = job.data
  const jobId = job.id!

  try {
    // Mark job as started
    await jobService.markJobStarted(jobId)
    await publishJobStarted(jobId, documentId, sessionId)

    // Process the job
    const result = await processor(job)

    // Mark job as complete
    await jobService.markJobComplete(jobId, result as Record<string, unknown>)
    await publishJobComplete(jobId, result, documentId, sessionId)

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const isNonRetryable = error instanceof NonRetryableJobError

    // Increment attempts
    const attempts = await jobService.incrementAttempts(jobId)

    // Check if we should retry
    const maxAttempts = job.opts.attempts ?? 3
    const shouldRetry = !isNonRetryable && attempts < maxAttempts

    if (!shouldRetry) {
      // Mark as failed (no more retries)
      await jobService.markJobFailed(jobId, errorMessage, attempts)
      await publishJobFailed(jobId, errorMessage, documentId, sessionId)
    }

    // Re-throw to let BullMQ handle retry logic
    throw error
  }
}

/**
 * Create a logger for workers
 */
export function createWorkerLogger(workerName: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      console.log(`[${workerName}] ${message}`, meta ? JSON.stringify(meta) : '')
    },
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => {
      console.error(`[${workerName}] ${message}`, error?.stack ?? '', meta ? JSON.stringify(meta) : '')
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(`[${workerName}] ${message}`, meta ? JSON.stringify(meta) : '')
      }
    },
  }
}

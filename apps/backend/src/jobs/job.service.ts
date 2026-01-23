import { db } from '../db/kysely'
import type { JobStatus, NewProcessingJob, ProcessingJob } from '../db/schema'
import type { CreateJobParams, JobStatusUpdate } from './job.types'

export class JobService {
  /**
   * Create a new job in the database
   */
  async createJob(params: CreateJobParams): Promise<ProcessingJob> {
    const newJob: NewProcessingJob = {
      job_type: params.jobType,
      target_type: params.targetType,
      target_id: params.targetId,
      status: 'pending',
      priority: params.priority ?? 0,
    }

    return db
      .insertInto('processing_jobs')
      .values(newJob)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<ProcessingJob | undefined> {
    return db
      .selectFrom('processing_jobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirst()
  }

  /**
   * Get multiple jobs by IDs
   */
  async getJobsByIds(jobIds: string[]): Promise<ProcessingJob[]> {
    if (jobIds.length === 0) return []

    return db
      .selectFrom('processing_jobs')
      .selectAll()
      .where('id', 'in', jobIds)
      .execute()
  }

  /**
   * Update job status
   */
  async updateJobStatus(jobId: string, update: JobStatusUpdate): Promise<ProcessingJob | undefined> {
    return db
      .updateTable('processing_jobs')
      .set({
        status: update.status,
        ...(update.attempts !== undefined && { attempts: update.attempts }),
        ...(update.error_message !== undefined && { error_message: update.error_message }),
        ...(update.result !== undefined && { result: update.result }),
        ...(update.started_at !== undefined && { started_at: update.started_at }),
        ...(update.completed_at !== undefined && { completed_at: update.completed_at }),
      })
      .where('id', '=', jobId)
      .returningAll()
      .executeTakeFirst()
  }

  /**
   * Mark job as started (processing)
   */
  async markJobStarted(jobId: string): Promise<ProcessingJob | undefined> {
    return this.updateJobStatus(jobId, {
      status: 'processing',
      started_at: new Date(),
    })
  }

  /**
   * Mark job as complete
   */
  async markJobComplete(jobId: string, result: Record<string, unknown>): Promise<ProcessingJob | undefined> {
    return this.updateJobStatus(jobId, {
      status: 'complete',
      result,
      completed_at: new Date(),
    })
  }

  /**
   * Mark job as failed
   */
  async markJobFailed(
    jobId: string,
    errorMessage: string,
    attempts: number
  ): Promise<ProcessingJob | undefined> {
    return this.updateJobStatus(jobId, {
      status: 'failed',
      error_message: errorMessage,
      attempts,
      completed_at: new Date(),
    })
  }

  /**
   * Increment job attempts (for retries)
   */
  async incrementAttempts(jobId: string): Promise<number> {
    const result = await db
      .updateTable('processing_jobs')
      .set((eb) => ({
        attempts: eb('attempts', '+', 1),
      }))
      .where('id', '=', jobId)
      .returning(['attempts'])
      .executeTakeFirst()

    return result?.attempts ?? 0
  }

  /**
   * Get jobs for a document
   */
  async getJobsForDocument(documentId: string): Promise<ProcessingJob[]> {
    return db
      .selectFrom('processing_jobs')
      .selectAll()
      .where('target_type', '=', 'document')
      .where('target_id', '=', documentId)
      .orderBy('created_at', 'desc')
      .execute()
  }

  /**
   * Get pending jobs (for queue recovery)
   */
  async getPendingJobs(limit = 100): Promise<ProcessingJob[]> {
    return db
      .selectFrom('processing_jobs')
      .selectAll()
      .where('status', 'in', ['pending', 'processing'])
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute()
  }

  /**
   * Get document processing status summary
   */
  async getDocumentProcessingStatus(documentId: string): Promise<{
    documentId: string
    ocrStatus: JobStatus | null
    thumbnailStatus: JobStatus | null
    jobs: Array<{
      type: string
      status: JobStatus
      completedAt: Date | null
    }>
  }> {
    const jobs = await this.getJobsForDocument(documentId)

    const ocrJob = jobs.find((j) => j.job_type === 'ocr')
    const thumbnailJob = jobs.find((j) => j.job_type === 'thumbnail')

    return {
      documentId,
      ocrStatus: ocrJob?.status ?? null,
      thumbnailStatus: thumbnailJob?.status ?? null,
      jobs: jobs.map((j) => ({
        type: j.job_type,
        status: j.status,
        completedAt: j.completed_at,
      })),
    }
  }
}

// Singleton instance
let jobServiceInstance: JobService | null = null

export function getJobService(): JobService {
  if (!jobServiceInstance) {
    jobServiceInstance = new JobService()
  }
  return jobServiceInstance
}



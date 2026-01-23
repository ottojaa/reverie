import type { JobStatus, JobType, TargetType } from '../db/schema'

export interface CreateJobParams {
  jobType: JobType
  targetType: TargetType
  targetId: string
  priority?: number
}

export interface JobRecord {
  id: string
  job_type: JobType
  target_type: TargetType
  target_id: string
  status: JobStatus
  priority: number
  attempts: number
  error_message: string | null
  result: Record<string, unknown> | null
  created_at: Date
  started_at: Date | null
  completed_at: Date | null
}

export interface JobStatusUpdate {
  status: JobStatus
  attempts?: number
  error_message?: string | null
  result?: Record<string, unknown> | null
  started_at?: Date | null
  completed_at?: Date | null
}

// Error types for job processing
export class RetryableJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableJobError'
  }
}

export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableJobError'
  }
}



import { env } from '../config/env'

// Queue names
export const QUEUE_NAMES = {
  OCR: 'ocr-queue',
  THUMBNAIL: 'thumbnail-queue',
  LLM: 'llm-queue',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

// Default job options
export const DEFAULT_JOB_OPTIONS = {
  attempts: env.JOB_RETRY_ATTEMPTS,
  backoff: {
    type: 'exponential' as const,
    delay: env.JOB_RETRY_BACKOFF_MS,
  },
  removeOnComplete: {
    count: 100, // Keep last 100 completed jobs
    age: 24 * 60 * 60, // Or 24 hours
  },
  removeOnFail: {
    count: 1000, // Keep last 1000 failed jobs for debugging
  },
}

// Queue-specific concurrency
export const QUEUE_CONCURRENCY = {
  [QUEUE_NAMES.OCR]: env.JOB_CONCURRENCY_OCR,
  [QUEUE_NAMES.THUMBNAIL]: env.JOB_CONCURRENCY_THUMBNAIL,
  [QUEUE_NAMES.LLM]: env.JOB_CONCURRENCY_LLM,
}


import { Queue } from 'bullmq'
import { getRedisConnectionOptions } from './redis'
import { QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from './queue.config'
import type { LlmProcessingType, LlmSkipReason } from '../llm/types'

export interface LlmJobData {
  documentId: string
  sessionId?: string | undefined
  /** Optional - will be determined by eligibility check if not provided */
  type?: LlmProcessingType | undefined
}

export interface LlmJobResult {
  summary: string | null
  enhancedMetadata: {
    title?: string | undefined
    keyEntities?: string[] | undefined
    topics?: string[] | undefined
    skipped?: boolean | undefined
    skipReason?: LlmSkipReason | undefined
    [key: string]: unknown
  }
  tokenCount: number
  skipped?: boolean | undefined
  skipReason?: LlmSkipReason | undefined
}

let llmQueueInstance: Queue | null = null

export function getLlmQueue(): Queue {
  if (!llmQueueInstance) {
    llmQueueInstance = new Queue(QUEUE_NAMES.LLM, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        attempts: 2, // Fewer retries for LLM (expensive)
      },
    })
  }
  return llmQueueInstance
}

export async function addLlmJob(
  data: LlmJobData,
  jobId: string
): Promise<void> {
  const queue = getLlmQueue()
  await queue.add('process-llm', data, {
    jobId,
    priority: 0,
  })
}

export async function closeLlmQueue(): Promise<void> {
  if (llmQueueInstance) {
    await llmQueueInstance.close()
    llmQueueInstance = null
  }
}

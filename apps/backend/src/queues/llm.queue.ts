import { Queue } from 'bullmq'
import { getRedisConnectionOptions } from './redis'
import { QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from './queue.config'

export interface LlmJobData {
  documentId: string
  sessionId?: string | undefined
  ocrText: string
}

export interface LlmJobResult {
  summary: string
  enhancedMetadata: {
    title?: string
    keyEntities?: string[]
    topics?: string[]
    [key: string]: unknown
  }
  tokenCount: number
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

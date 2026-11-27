import { Entity } from '@reverie/shared';
import { Queue } from 'bullmq';
import type { LlmSkipReason, StoredLlmProcessingType } from '../llm/types';
import { toLaneJob } from './lane';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queue.config';
import { getRedisConnectionOptions } from './redis';

export interface LlmJobData {
    documentId: string;
    /** Document owner; used to route job events to the owner's socket room only. */
    userId: string;
    sessionId?: string | undefined;
    /** Optional - will be determined by eligibility check if not provided. Jobs queued before the image call may say `vision_describe`. */
    type?: StoredLlmProcessingType | undefined;
}

export interface LlmJobResult {
    summary: string | null;
    enhancedMetadata: {
        title?: string | undefined;
        entities?: Entity[] | undefined;
        topics?: string[] | undefined;
        skipped?: boolean | undefined;
        skipReason?: LlmSkipReason | undefined;
        [key: string]: unknown;
    };
    /** Null when the provider (a local server) reported no token counts. */
    tokenCount: number | null;
    skipped?: boolean | undefined;
    skipReason?: LlmSkipReason | undefined;
}

let llmQueueInstance: Queue | null = null;

export function getLlmQueue(): Queue {
    if (!llmQueueInstance) {
        llmQueueInstance = new Queue(QUEUE_NAMES.LLM, {
            connection: getRedisConnectionOptions(),
            defaultJobOptions: {
                ...DEFAULT_JOB_OPTIONS,
                attempts: 2, // Fewer retries for LLM (expensive)
            },
        });
    }

    return llmQueueInstance;
}

export async function addLlmJob(data: LlmJobData, jobId: string): Promise<void> {
    const queue = getLlmQueue();
    const { options } = await toLaneJob(data.documentId, { jobId, priority: 0 });
    await queue.add('process-llm', data, options);
}

export async function closeLlmQueue(): Promise<void> {
    if (llmQueueInstance) {
        await llmQueueInstance.close();
        llmQueueInstance = null;
    }
}

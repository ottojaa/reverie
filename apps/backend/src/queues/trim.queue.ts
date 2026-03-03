import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from './redis';
import { QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from './queue.config';

export interface TrimJobData {
    documentId: string;
    userId: string;
    start: number;
    end: number;
    saveAsCopy: boolean;
    sessionId?: string;
}

export interface TrimJobResult {
    newDocumentId?: string;
}

let trimQueueInstance: Queue | null = null;

export function getTrimQueue(): Queue {
    if (!trimQueueInstance) {
        trimQueueInstance = new Queue(QUEUE_NAMES.TRIM, {
            connection: getRedisConnectionOptions(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }

    return trimQueueInstance;
}

export async function addTrimJob(data: TrimJobData, jobId: string): Promise<void> {
    const queue = getTrimQueue();
    await queue.add('trim-video', data, {
        jobId,
        priority: 5,
    });
}

export async function closeTrimQueue(): Promise<void> {
    if (trimQueueInstance) {
        await trimQueueInstance.close();
        trimQueueInstance = null;
    }
}

import { Queue } from 'bullmq';
import { fetchLaneJob } from './lane';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type QueueName } from './queue.config';
import { getRedisConnectionOptions } from './redis';
import type { DocumentCategory } from '../ocr/types';

export interface OcrJobData {
    documentId: string;
    /** Document owner; used to route job events to the owner's socket room only. */
    userId: string;
    sessionId?: string;
    filePath: string;
    /** Force reprocessing even if already complete */
    forceReprocess?: boolean;
}

export interface OcrJobResult {
    rawText: string;
    confidence: number;
    textDensity: number;
    hasMeaningfulText: boolean;
    category: DocumentCategory;
    needsReview: boolean;
    ocrEngine: string;
}

let ocrQueueInstance: Queue | null = null;
let backgroundQueueInstance: Queue | null = null;

function createQueue(name: QueueName): Queue {
    return new Queue(name, { connection: getRedisConnectionOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

export function getOcrQueue(): Queue {
    ocrQueueInstance ??= createQueue(QUEUE_NAMES.OCR);

    return ocrQueueInstance;
}

/** Background documents' OCR has its own queue, so that a normal document's never waits for a backlog's worker slot. */
export function getBackgroundOcrQueue(): Queue {
    backgroundQueueInstance ??= createQueue(QUEUE_NAMES.OCR_BACKGROUND);

    return backgroundQueueInstance;
}

export async function addOcrJob(data: OcrJobData, jobId: string): Promise<void> {
    const { lane, options } = await fetchLaneJob(data.documentId, { jobId, priority: 0 });
    const queue = lane === 'background' ? getBackgroundOcrQueue() : getOcrQueue();

    await queue.add('process-ocr', data, options);
}

export async function closeOcrQueue(): Promise<void> {
    await Promise.all([ocrQueueInstance?.close(), backgroundQueueInstance?.close()]);
    ocrQueueInstance = null;
    backgroundQueueInstance = null;
}

import { createLaneQueues } from './lane-queues';
import { QUEUE_NAMES } from './queue.config';
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

const queues = createLaneQueues(QUEUE_NAMES.OCR, QUEUE_NAMES.OCR_BACKGROUND);

export const getOcrQueue = queues.normal;
export const getBackgroundOcrQueue = queues.background;
export const closeOcrQueue = queues.close;

export async function addOcrJob(data: OcrJobData, jobId: string): Promise<void> {
    await queues.add('process-ocr', data, { jobId, priority: 0 });
}

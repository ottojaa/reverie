import { Worker, Job } from 'bullmq';
import { getRedisConnectionOptions } from '../queues/redis';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../queues/queue.config';
import type { OcrJobData, OcrJobResult } from '../queues/ocr.queue';
import { addLlmJob } from '../queues/llm.queue';
import { processJobWithTracking, createWorkerLogger, publishJobProgress } from './worker.utils';
import { db } from '../db/kysely';
import { NonRetryableJobError } from '../jobs/job.types';
import { processDocument, shouldQueueLlmJob, isProcessableImage } from '../ocr';

const logger = createWorkerLogger('OCR');

/**
 * Process an OCR job (Plan 05 implementation)
 */
async function processOcrJob(job: Job<OcrJobData>): Promise<OcrJobResult> {
    const { documentId, forceReprocess } = job.data;

    logger.info('Processing OCR job', { documentId });

    // Verify document exists
    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();

    if (!document) {
        throw new NonRetryableJobError(`Document ${documentId} not found`);
    }

    // Update progress - starting OCR
    await publishJobProgress(job.id!, 10, documentId, job.data.sessionId);

    // Update document status to processing
    await db.updateTable('documents').set({ ocr_status: 'processing' }).where('id', '=', documentId).execute();

    try {
        // Check if file is processable for OCR
        if (!isProcessableImage(document.mime_type)) {
            logger.info('Skipping OCR for non-image file', { documentId, mimeType: document.mime_type });

            // Mark as complete with no text
            await db
                .updateTable('documents')
                .set({
                    ocr_status: 'complete',
                    has_meaningful_text: false,
                })
                .where('id', '=', documentId)
                .execute();

            // Insert empty OCR result
            await db
                .insertInto('ocr_results')
                .values({
                    document_id: documentId,
                    raw_text: '',
                    confidence_score: 0,
                    metadata: null,
                })
                .onConflict((oc) => oc.column('document_id').doNothing())
                .execute();

            return {
                rawText: '',
                confidence: 0,
                textDensity: 0,
                hasMeaningfulText: false,
                category: 'other',
                needsReview: false,
                metadata: null,
            };
        }

        await publishJobProgress(job.id!, 30, documentId, job.data.sessionId);

        // Run OCR processing
        const result = await processDocument(documentId, forceReprocess ? { forceReprocess: true } : {});

        await publishJobProgress(job.id!, 80, documentId, job.data.sessionId);

        // Queue LLM job if appropriate
        if (shouldQueueLlmJob(result)) {
            const llmJobId = `llm-${documentId}`;
            await addLlmJob(
                {
                    documentId,
                    sessionId: job.data.sessionId,
                    // Type will be determined by eligibility check in LLM worker
                },
                llmJobId
            );
            logger.info('Queued LLM job', { documentId, llmJobId });
        } else {
            logger.info('Skipping LLM job', {
                documentId,
                reason: result.hasMeaningfulText ? 'low_confidence' : 'no_text',
            });
        }

        await publishJobProgress(job.id!, 100, documentId, job.data.sessionId);

        logger.info('OCR job completed', {
            documentId,
            confidence: result.confidenceScore,
            hasMeaningfulText: result.hasMeaningfulText,
            category: result.category,
        });

        return {
            rawText: result.rawText,
            confidence: result.confidenceScore,
            textDensity: result.textDensity,
            hasMeaningfulText: result.hasMeaningfulText,
            category: result.category,
            needsReview: result.needsReview,
            metadata: result.metadata,
        };
    } catch (error) {
        // Update document status to failed
        await db.updateTable('documents').set({ ocr_status: 'failed' }).where('id', '=', documentId).execute();

        throw error;
    }
}

/**
 * Create and start the OCR worker
 */
export function createOcrWorker(): Worker<OcrJobData, OcrJobResult> {
    const worker = new Worker<OcrJobData, OcrJobResult>(QUEUE_NAMES.OCR, async (job) => processJobWithTracking(job, processOcrJob), {
        connection: getRedisConnectionOptions(),
        concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.OCR],
    });

    worker.on('completed', (job) => {
        logger.info('Job completed', { jobId: job.id });
    });

    worker.on('failed', (job, error) => {
        logger.error('Job failed', error, { jobId: job?.id });
    });

    worker.on('error', (error) => {
        logger.error('Worker error', error);
    });

    logger.info('OCR worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.OCR] });

    return worker;
}

// Run as standalone if executed directly
if (require.main === module) {
    createOcrWorker();
}

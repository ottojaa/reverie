import { Job, Worker } from 'bullmq';
import { db } from '../db/kysely';
import { NonRetryableJobError } from '../jobs/job.types';
import { checkLlmEligibility } from '../llm/eligibility';
import { processDocument } from '../llm/llm.service';
import type { LlmJobData, LlmJobResult } from '../queues/llm.queue';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import { createWorkerLogger, processJobWithTracking, publishJobProgress } from './worker.utils';

const logger = createWorkerLogger('LLM');

/**
 * Process an LLM job
 *
 * Routes to appropriate LLM processor based on document type:
 * - text_summary: For documents with meaningful text
 * - vision_describe: For images without text (when vision enabled)
 * - skip: For ineligible documents
 */
async function processLlmJob(job: Job<LlmJobData>): Promise<LlmJobResult> {
    const { documentId, type } = job.data;

    logger.info('Processing LLM job', { documentId, type });

    // Verify document exists
    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();

    if (!document) {
        throw new NonRetryableJobError(`Document ${documentId} not found`);
    }

    await publishJobProgress(job.id!, 10, documentId, job.data.sessionId);

    // Fetch OCR result if exists
    const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', documentId).executeTakeFirst();

    await publishJobProgress(job.id!, 20, documentId, job.data.sessionId);

    // Check eligibility
    const eligibility = checkLlmEligibility(document, ocrResult);
    const processingType = type || eligibility.processingType;

    if (!eligibility.eligible && !type) {
        logger.info('LLM processing skipped', {
            documentId,
            reason: eligibility.reason,
            warnings: eligibility.warnings,
        });

        return {
            summary: null,
            enhancedMetadata: {
                skipped: true,
                skipReason: eligibility.reason,
            },
            tokenCount: 0,
            skipped: true,
            skipReason: eligibility.reason,
        };
    }

    // Log warnings if any
    if (eligibility.warnings) {
        logger.warn('LLM processing warnings', { documentId, warnings: eligibility.warnings });
    }

    await publishJobProgress(job.id!, 40, documentId, job.data.sessionId);

    // Process document with LLM
    const llmResult = await processDocument(documentId, processingType);

    await publishJobProgress(job.id!, 90, documentId, job.data.sessionId);

    // Build result
    const metadata = llmResult.enhancedMetadata
        ? {
              title: llmResult.enhancedMetadata.title,
              keyEntities: llmResult.enhancedMetadata.keyEntities,
              topics: llmResult.enhancedMetadata.topics,
          }
        : {};

    const result: LlmJobResult = {
        summary: llmResult.summary ?? null,
        enhancedMetadata: metadata,
        tokenCount: llmResult.tokenCount ?? 0,
        skipped: llmResult.skipped,
        skipReason: llmResult.reason,
    };

    logger.info('LLM job completed', {
        documentId,
        skipped: result.skipped,
        tokenCount: result.tokenCount,
        processingType,
    });

    return result;
}

/**
 * Create and start the LLM worker
 */
export function createLlmWorker(): Worker<LlmJobData, LlmJobResult> {
    const worker = new Worker<LlmJobData, LlmJobResult>(QUEUE_NAMES.LLM, async (job) => processJobWithTracking(job, processLlmJob), {
        connection: getRedisConnectionOptions(),
        concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.LLM],
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

    logger.info('LLM worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.LLM] });

    return worker;
}

// Run as standalone if executed directly
if (require.main === module) {
    createLlmWorker();
}

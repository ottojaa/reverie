import { Job, Worker, type Processor } from 'bullmq';
import { sql } from 'kysely';
import { db } from '../db/kysely';
import type { Document } from '../db/schema';
import { NonRetryableJobError } from '../jobs/job.types';
import { enqueueTextEmbedding } from '../embeddings/enqueue';
import { getMlClient } from '../embeddings/ml.client';
import { settleKindAfterOcr } from '../image-kind/after-ocr';
import { decideLlmHandoff, isKindFlipActive, type KindDeps } from '../image-kind/service';
import { isProcessableImage, isTextExtractable, processDocument, shouldQueueLlmJob } from '../ocr';
import { toPhotoMetadataValues } from '../ocr/exif-extractor';
import type { OcrProcessingResult } from '../ocr/types';
import { addLlmJob } from '../queues/llm.queue';
import { getBackgroundOcrQueue, getOcrQueue, type OcrJobData, type OcrJobResult } from '../queues/ocr.queue';
import { QUEUE_NAMES } from '../queues/queue.config';
import { rebuildSearchVector } from '../search/search-indexer';
import { heldWhileNormalBusy } from './background-hold';
import { logJobOutcomes, startWorker } from './start-worker';
import { createWorkerLogger, processJobWithTracking, publishJobProgress } from './worker.utils';

const logger = createWorkerLogger('OCR');

/** Queue the LLM job when the OCR result warrants one, else mark it skipped. */
async function queueLlmFromOcr(document: Document, result: OcrProcessingResult, sessionId: string | undefined): Promise<void> {
    const documentId = document.id;

    if (!shouldQueueLlmJob(result)) {
        await db.updateTable('documents').set({ llm_status: 'skipped' }).where('id', '=', documentId).execute();
        logger.info('Skipping LLM job', {
            documentId,
            reason: result.hasMeaningfulText ? 'low_confidence' : 'no_text',
        });

        return;
    }

    await db.updateTable('documents').set({ llm_status: 'pending' }).where('id', '=', documentId).execute();

    const createdJob = await db
        .insertInto('processing_jobs')
        .values({
            user_id: document.user_id,
            job_type: 'llm_summary',
            target_type: 'document',
            target_id: documentId,
            status: 'pending',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    await addLlmJob({ documentId, userId: document.user_id, sessionId }, createdJob.id);
    logger.info('Queued LLM job', { documentId, llmJobId: createdJob.id });
}

/** What settling an image's kind needs; null without reverie-ml. */
function toKindDeps(): KindDeps | null {
    const ml = getMlClient();

    return ml && { db, ml, flip: isKindFlipActive(), addLlmJob };
}

async function processOcrJob(job: Job<OcrJobData>): Promise<OcrJobResult> {
    const { documentId, forceReprocess } = job.data;

    logger.info('Processing OCR job', { documentId });

    // Verify document exists
    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();

    if (!document) {
        throw new NonRetryableJobError(`Document ${documentId} not found`);
    }

    // Update progress - starting OCR
    await publishJobProgress(job.id!, 10, documentId, job.data.sessionId, job.data.userId);

    // Update document status to processing
    // The marker says OCR has stored the text flag and EXIF; it is set again below once it has.
    await db.updateTable('documents').set({ ocr_status: 'processing', ocr_facts_at: null }).where('id', '=', documentId).execute();

    try {
        // Check if file is processable: images go through OCR; PDF/TXT go through processDocument (handleNonImageFile)
        const isImage = isProcessableImage(document.mime_type);
        const isPdfOrTxt = isTextExtractable(document.mime_type);

        if (!isImage && !isPdfOrTxt) {
            logger.info('Skipping OCR for unsupported file type', { documentId, mimeType: document.mime_type });

            await db.updateTable('documents').set({ ocr_status: 'complete', has_meaningful_text: false }).where('id', '=', documentId).execute();

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
                ocrEngine: 'none',
            };
        }

        await publishJobProgress(job.id!, 30, documentId, job.data.sessionId, job.data.userId);

        // Run OCR processing (images) or text extraction (PDF/TXT)
        const result = await processDocument(documentId, {
            ...(forceReprocess ? { forceReprocess: true } : {}),
            document,
            lane: job.queueName === QUEUE_NAMES.OCR_BACKGROUND ? 'background' : 'normal',
        });

        await publishJobProgress(job.id!, 80, documentId, job.data.sessionId, job.data.userId);

        // Store EXIF metadata if extracted (no values at all: skip, since doUpdateSet with an empty
        // object produces invalid SQL: "syntax error at end of input")
        const exif = result.exifMetadata;
        const exifValues = toPhotoMetadataValues(exif);

        if (exif && exifValues) {
            await db
                .insertInto('photo_metadata')
                .values({
                    document_id: documentId,
                    ...exifValues,
                })
                .onConflict((oc) => oc.column('document_id').doUpdateSet(exifValues))
                .execute();

            logger.info('Stored EXIF metadata', {
                documentId,
                hasGps: exif.latitude !== null,
                city: exif.city,
                country: exif.country,
                takenAt: exif.takenAt,
            });
            // Deliberately NOT backfilling documents.extracted_date from EXIF:
            // extracted_date means "date the document was issued" (LLM-extracted);
            // a photo's capture time lives in photo_metadata.taken_at instead.
        }

        // Sync has_meaningful_text from OCR result back to documents table
        await db.updateTable('documents').set({ has_meaningful_text: result.hasMeaningfulText }).where('id', '=', documentId).execute();

        // From here the embed side may act on this OCR run: it waits for the marker. The database's clock, not
        // this process's, because the marker is compared with `processing_jobs.created_at`, which the database stamps.
        // An OCR run that read the file's EXIF also marks the camera columns and the full EXIF read; the embed backfill reads the rest.
        await db
            .updateTable('documents')
            .set({ ocr_facts_at: sql<Date>`now()`, ...(exif && { camera_read_at: sql<Date>`now()`, media_read_at: sql<Date>`now()` }) })
            .where('id', '=', documentId)
            .execute();

        // With the image-kind flip on, the embed side queues an image's LLM job once the image has a kind.
        const handoff = isImage ? await decideLlmHandoff(isKindFlipActive(), getMlClient()) : 'ocr';

        if (handoff === 'ocr') await queueLlmFromOcr(document, result, job.data.sessionId);

        // Rebuild unified search vector with OCR text + EXIF metadata.
        // Will be rebuilt again after LLM processing if queued.
        await rebuildSearchVector(db, documentId);
        await enqueueTextEmbedding(documentId);

        // After the rebuild, so the search text does not pick up the category the kind is about to set.
        if (isImage) await settleKindAfterOcr(documentId, toKindDeps());

        await publishJobProgress(job.id!, 100, documentId, job.data.sessionId, job.data.userId);

        logger.info('OCR job completed', {
            documentId,
            confidence: result.confidenceScore,
            hasMeaningfulText: result.hasMeaningfulText,
            category: result.category,
            ocrEngine: result.ocrEngine,
        });

        return {
            rawText: result.rawText,
            confidence: result.confidenceScore,
            textDensity: result.textDensity,
            hasMeaningfulText: result.hasMeaningfulText,
            category: result.category,
            needsReview: result.needsReview,
            ocrEngine: result.ocrEngine,
        };
    } catch (error) {
        // Update document status to failed
        await db.updateTable('documents').set({ ocr_status: 'failed' }).where('id', '=', documentId).execute();

        throw error;
    }
}

async function runTrackedOcrJob(job: Job<OcrJobData>): Promise<OcrJobResult> {
    return processJobWithTracking(job, processOcrJob, {
        storeDuration: async (documentId, durationMs) => {
            await db.updateTable('ocr_results').set({ duration_ms: durationMs }).where('document_id', '=', documentId).execute();
        },
    });
}

type OcrQueueName = typeof QUEUE_NAMES.OCR | typeof QUEUE_NAMES.OCR_BACKGROUND;

function startOcrWorker(queueName: OcrQueueName, processor: Processor<OcrJobData, OcrJobResult>): Worker<OcrJobData, OcrJobResult> {
    const worker = startWorker(queueName, processor, {
        label: 'OCR',
        logger,
        // PaddleOCR model loading on first request can take 20s+;
        // default stalledInterval (30s) is too tight and causes false stalls.
        options: { stalledInterval: 120_000, lockDuration: 120_000 },
    });

    logJobOutcomes(worker, logger);

    return worker;
}

/**
 * Create and start the OCR worker
 */
export function createOcrWorker(): Worker<OcrJobData, OcrJobResult> {
    return startOcrWorker(QUEUE_NAMES.OCR, runTrackedOcrJob);
}

/** Runs background documents' OCR, and starts none while a normal document's OCR is waiting or running. */
export function createBackgroundOcrWorker(): Worker<OcrJobData, OcrJobResult> {
    return startOcrWorker(QUEUE_NAMES.OCR_BACKGROUND, heldWhileNormalBusy(getOcrQueue, getBackgroundOcrQueue, runTrackedOcrJob));
}

// Run as standalone if executed directly
if (require.main === module) {
    createOcrWorker();
    createBackgroundOcrWorker();
}

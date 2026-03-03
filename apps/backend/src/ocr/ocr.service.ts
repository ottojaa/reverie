import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { env } from '../config/env';
import { db } from '../db/kysely';
import type { Document } from '../db/schema';
import { getStorageService } from '../services/storage.service';
import { classifyNonTextImage } from './category-classifier';
import { extractExifMetadata } from './exif-extractor';
import { getImageMetadata, getImageSize, isProcessableImage, preprocessImage, validateImageForOcr } from './image-preprocessor';
import { recognizeFromFilePath, recognizeText as recognizeWithPaddleOcr } from './paddleocr.client';
import { recognizeText as recognizeWithTesseract, terminateWorker } from './tesseract.client';
import { detectTextPresence, shouldFlagForReview, shouldSkipLlmProcessing } from './text-detector';
import { extractTextFromBuffer, isTextExtractable } from './text-extractor';
import type { DocumentCategory, OcrOutput, OcrProcessingResult } from './types';

/**
 * OCR Service
 *
 * Main orchestration for OCR processing:
 * 1. Load and validate image
 * 2. Preprocess for optimal OCR
 * 3. Run text extraction (PaddleOCR or Tesseract)
 * 4. Detect if meaningful text exists
 * 5. Classify non-text images (text classification deferred to LLM)
 * 6. Store results with engine provenance
 */

export interface ProcessDocumentOptions {
    /** Skip preprocessing (for already optimized images) */
    skipPreprocessing?: boolean | undefined;
    /** Force reprocessing even if already complete */
    forceReprocess?: boolean | undefined;
    /** Optional preloaded document from worker */
    document?: Document | undefined;
}

function shouldLogTimings(): boolean {
    return process.env.NODE_ENV !== 'production';
}

/**
 * Run OCR on an image buffer using the configured engine
 */
async function runOcr(imageBuffer: Buffer): Promise<OcrOutput> {
    if (env.OCR_ENGINE === 'paddleocr') {
        return recognizeWithPaddleOcr(imageBuffer);
    }

    return recognizeWithTesseract(imageBuffer);
}

/**
 * Process a document for OCR
 */
export async function processDocument(documentId: string, options: ProcessDocumentOptions = {}): Promise<OcrProcessingResult> {
    const totalStart = Date.now();
    const timings: Record<string, number> = {};
    const storageService = getStorageService();

    const fetchStart = Date.now();
    // 1. Fetch document from DB
    const document = options.document ?? (await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst());
    timings.fetchDocumentMs = Date.now() - fetchStart;

    if (!document) {
        throw new Error(`Document ${documentId} not found`);
    }

    // Check if already processed (unless forcing reprocess)
    if (document.ocr_status === 'complete' && !options.forceReprocess) {
        const existing = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', documentId).executeTakeFirst();

        if (existing) {
            return {
                rawText: existing.raw_text,
                confidenceScore: existing.confidence_score ?? 0,
                textDensity: (existing as { text_density?: number }).text_density ?? 0,
                hasMeaningfulText: (existing as { has_meaningful_text?: boolean }).has_meaningful_text ?? true,
                category: (document.document_category as DocumentCategory) ?? 'other',
                needsReview: false,
                ocrEngine: (existing as { ocr_engine?: string }).ocr_engine ?? 'unknown',
            };
        }
    }

    // 2. Check if file type is processable
    if (!isProcessableImage(document.mime_type)) {
        return handleNonImageFile(documentId, document);
    }

    // 3. Load image from storage
    const readFileStart = Date.now();
    const imageBuffer = await storageService.getFile(document.file_path);
    timings.readFileMs = Date.now() - readFileStart;

    // Decode image metadata once and reuse across validation/sizing/preprocessing
    const metadataStart = Date.now();
    const imageMetadata = await getImageMetadata(imageBuffer);
    timings.imageMetadataMs = Date.now() - metadataStart;

    // 4. Validate image
    const validation = await validateImageForOcr(imageBuffer, imageMetadata);

    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // 5. Get image dimensions
    const imageSize = await getImageSize(imageBuffer, imageMetadata);

    // 6. Preprocess image for OCR + extract EXIF metadata in parallel
    const preprocessStart = Date.now();
    const [processedImage, exifMetadata] = await Promise.all([
        options.skipPreprocessing ? Promise.resolve(imageBuffer) : preprocessImage(imageBuffer, {}, imageMetadata),
        extractExifMetadata(imageBuffer),
    ]);
    timings.preprocessMs = Date.now() - preprocessStart;

    // 7. Run OCR
    const ocrStart = Date.now();
    const ocrOutput = await runOcr(processedImage);
    timings.ocrEngineMs = Date.now() - ocrStart;

    // 8. Detect if meaningful text exists
    const textDetection = detectTextPresence(ocrOutput, imageSize);

    // 9. Classify non-text images only (text documents classified by LLM later)
    let category: DocumentCategory;

    if (textDetection.hasMeaningfulText) {
        // LLM will classify later; set placeholder
        category = 'other';
    } else {
        category = classifyNonTextImage(imageSize, document.original_filename);
    }

    // 10. Determine if needs review
    const needsReview = shouldFlagForReview(textDetection.confidenceScore, textDetection.hasMeaningfulText);

    // 11. Build result
    const result: OcrProcessingResult = {
        rawText: ocrOutput.text,
        confidenceScore: textDetection.confidenceScore,
        textDensity: textDetection.textDensity,
        hasMeaningfulText: textDetection.hasMeaningfulText,
        category,
        needsReview,
        ocrEngine: ocrOutput.engine,
        exifMetadata,
    };

    // 12. Save to database
    const dbWriteStart = Date.now();
    await saveOcrResult(documentId, result);
    timings.dbWriteMs = Date.now() - dbWriteStart;
    timings.totalMs = Date.now() - totalStart;

    if (shouldLogTimings()) {
        console.info('[OCRService] process timings', JSON.stringify({ documentId, ...timings }));
    }

    return result;
}

/**
 * Handle non-image files: PDF (via PaddleOCR) or TXT/MD/CSV (direct extraction)
 */
async function handleNonImageFile(documentId: string, document: Document): Promise<OcrProcessingResult> {
    const category = document.mime_type.startsWith('video/') ? 'video' : 'other';
    const baseResult: OcrProcessingResult = {
        rawText: '',
        confidenceScore: 0,
        textDensity: 0,
        hasMeaningfulText: false,
        category,
        needsReview: false,
        ocrEngine: 'none',
    };

    if (!isTextExtractable(document.mime_type)) {
        await saveOcrResult(documentId, baseResult);

        return baseResult;
    }

    const storageService = getStorageService();
    const buffer = await storageService.getFile(document.file_path);

    // PDF: PaddleOCR only (skip when tesseract)
    if (document.mime_type === 'application/pdf') {
        if (env.OCR_ENGINE !== 'paddleocr') {
            await saveOcrResult(documentId, baseResult);

            return baseResult;
        }

        const tempDir = await mkdtemp(join(tmpdir(), 'reverie-pdf-'));
        const tempPath = join(tempDir, `input-${Date.now()}.pdf`);
        await writeFile(tempPath, buffer);

        try {
            const ocrOutput = await recognizeFromFilePath(tempPath);
            const result: OcrProcessingResult = {
                ...baseResult,
                rawText: ocrOutput.text,
                confidenceScore: ocrOutput.confidence,
                hasMeaningfulText: ocrOutput.text.trim().length > 0,
                ocrEngine: ocrOutput.engine ?? 'paddleocr',
            };
            await saveOcrResult(documentId, result);

            return result;
        } finally {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    // TXT/MD/CSV: direct text extraction
    const { text } = await extractTextFromBuffer(buffer, document.mime_type);
    const result: OcrProcessingResult = {
        ...baseResult,
        rawText: text,
        confidenceScore: 100,
        hasMeaningfulText: text.trim().length > 0,
        ocrEngine: 'text_extract',
    };
    await saveOcrResult(documentId, result);

    return result;
}

/**
 * Save OCR result to database
 */
async function saveOcrResult(documentId: string, result: OcrProcessingResult): Promise<void> {
    // Upsert OCR result
    const existing = await db.selectFrom('ocr_results').select('id').where('document_id', '=', documentId).executeTakeFirst();

    if (existing) {
        await db
            .updateTable('ocr_results')
            .set({
                raw_text: result.rawText,
                confidence_score: result.confidenceScore,
                metadata: null, // Metadata now comes from LLM phase
                ocr_engine: result.ocrEngine,
            })
            .where('document_id', '=', documentId)
            .execute();
    } else {
        await db
            .insertInto('ocr_results')
            .values({
                document_id: documentId,
                raw_text: result.rawText,
                confidence_score: result.confidenceScore,
                metadata: null,
                ocr_engine: result.ocrEngine,
            })
            .execute();
    }

    // Update document
    await db
        .updateTable('documents')
        .set({
            ocr_status: 'complete',
            document_category: result.category,
        })
        .where('id', '=', documentId)
        .execute();
}

/**
 * Check if a document should have LLM processing after OCR
 */
export function shouldQueueLlmJob(result: OcrProcessingResult): boolean {
    return !shouldSkipLlmProcessing(result.confidenceScore, result.hasMeaningfulText);
}

/**
 * Cleanup: Terminate Tesseract worker
 * Should be called on application shutdown
 */
export async function shutdownOcrService(): Promise<void> {
    await terminateWorker();
}

// Re-export types for convenience
export type { DocumentCategory, OcrProcessingResult };

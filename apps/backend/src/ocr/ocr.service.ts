import { db } from '../db/kysely';
import type { OcrMetadata } from '../db/schema';
import { getStorageService } from '../services/storage.service';
import { classifyDocument, classifyNonTextImage } from './category-classifier';
import { getImageSize, isProcessableImage, preprocessImage, validateImageForOcr } from './image-preprocessor';
import { extractMetadata } from './metadata-extractor';
import { recognizeText, terminateWorker } from './tesseract.client';
import { detectTextPresence, shouldFlagForReview, shouldSkipLlmProcessing } from './text-detector';
import type { DocumentCategory, ExtractedMetadata, OcrProcessingResult } from './types';

/**
 * OCR Service (Plan 05)
 *
 * Main orchestration for OCR processing:
 * 1. Load and validate image
 * 2. Preprocess for optimal OCR
 * 3. Run text extraction
 * 4. Detect if meaningful text exists
 * 5. Extract metadata (if text found)
 * 6. Classify document
 * 7. Store results
 */

export interface ProcessDocumentOptions {
    /** Skip preprocessing (for already optimized images) */
    skipPreprocessing?: boolean | undefined;
    /** Force reprocessing even if already complete */
    forceReprocess?: boolean | undefined;
}

/**
 * Process a document for OCR
 */
export async function processDocument(documentId: string, options: ProcessDocumentOptions = {}): Promise<OcrProcessingResult> {
    const storageService = getStorageService();

    // 1. Fetch document from DB
    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();

    if (!document) {
        throw new Error(`Document ${documentId} not found`);
    }

    // Check if already processed (unless forcing reprocess)
    if (document.ocr_status === 'complete' && !options.forceReprocess) {
        // Fetch existing result
        const existing = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', documentId).executeTakeFirst();

        if (existing) {
            const metadata = existing.metadata as OcrMetadata | null;
            return {
                rawText: existing.raw_text,
                confidenceScore: existing.confidence_score ?? 0,
                textDensity: (existing as { text_density?: number }).text_density ?? 0,
                hasMeaningfulText: (existing as { has_meaningful_text?: boolean }).has_meaningful_text ?? true,
                metadata: metadata ? convertStoredMetadata(metadata) : null,
                category: (document.document_category as DocumentCategory) ?? 'other',
                needsReview: false,
            };
        }
    }

    // 2. Check if file type is processable
    if (!isProcessableImage(document.mime_type)) {
        // For non-image files, mark as complete with empty result
        // Text extraction for PDFs, docx, etc. happens elsewhere
        return handleNonImageFile(documentId, document.mime_type);
    }

    // 3. Load image from storage
    const imageBuffer = await storageService.getFile(document.file_path);

    // 4. Validate image
    const validation = await validateImageForOcr(imageBuffer);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // 5. Get image dimensions
    const imageSize = await getImageSize(imageBuffer);

    // 6. Preprocess image for OCR
    const processedImage = options.skipPreprocessing ? imageBuffer : await preprocessImage(imageBuffer);

    // 7. Run OCR
    const ocrOutput = await recognizeText(processedImage);

    // 8. Detect if meaningful text exists
    const textDetection = detectTextPresence(ocrOutput, imageSize);

    // 9. Extract metadata and classify
    let metadata: ExtractedMetadata | null = null;
    let category: DocumentCategory;

    if (textDetection.hasMeaningfulText) {
        metadata = extractMetadata(ocrOutput.text);
        category = classifyDocument(ocrOutput.text, metadata, true);
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
        metadata,
        category,
        needsReview,
    };

    // 12. Save to database
    await saveOcrResult(documentId, result);

    return result;
}

/**
 * Handle non-image files that don't need OCR
 */
async function handleNonImageFile(documentId: string, mimeType: string): Promise<OcrProcessingResult> {
    const result: OcrProcessingResult = {
        rawText: '',
        confidenceScore: 0,
        textDensity: 0,
        hasMeaningfulText: false,
        metadata: null,
        category: 'other',
        needsReview: false,
    };

    // For text-based files (txt, md, csv), text extraction happens in upload service
    // For PDFs and Office docs, future implementation will handle them
    const textTypes = ['text/plain', 'text/markdown', 'text/csv'];
    if (textTypes.includes(mimeType)) {
        // These have text but don't need OCR
        result.hasMeaningfulText = true;
    }

    await saveOcrResult(documentId, result);

    return result;
}

/**
 * Save OCR result to database
 */
async function saveOcrResult(documentId: string, result: OcrProcessingResult): Promise<void> {
    // Convert metadata to storage format
    const storageMetadata: OcrMetadata | null = result.metadata
        ? {
              companies: result.metadata.companies,
              dates: result.metadata.dates.map((d) => d.toISOString()),
              values: result.metadata.currencyValues,
          }
        : null;

    // Upsert OCR result (update if exists, insert if not)
    const existing = await db.selectFrom('ocr_results').select('id').where('document_id', '=', documentId).executeTakeFirst();

    if (existing) {
        await db
            .updateTable('ocr_results')
            .set({
                raw_text: result.rawText,
                confidence_score: result.confidenceScore,
                metadata: storageMetadata,
                // Note: text_density and has_meaningful_text columns added in migration 002
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
                metadata: storageMetadata,
            })
            .execute();
    }

    // Update document
    await db
        .updateTable('documents')
        .set({
            ocr_status: 'complete',
            document_category: result.category,
            extracted_date: result.metadata?.primaryDate ?? null,
            // Note: has_meaningful_text column added in migration 002
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

/**
 * Convert stored metadata format to ExtractedMetadata
 */
function convertStoredMetadata(metadata: OcrMetadata): ExtractedMetadata {
    const result: ExtractedMetadata = {
        dates: (metadata.dates || []).map((d) => new Date(d as unknown as string)),
        companies: metadata.companies || [],
        currencyValues: metadata.values || [],
        percentages: [],
    };

    // Only set primaryDate if it exists
    if (metadata.dates && metadata.dates[0]) {
        result.primaryDate = new Date(metadata.dates[0] as unknown as string);
    }

    return result;
}

// Re-export types for convenience
export type { OcrProcessingResult, DocumentCategory, ExtractedMetadata };

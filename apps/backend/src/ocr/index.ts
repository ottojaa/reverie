/**
 * OCR Pipeline (Plan 05)
 *
 * Exports for OCR processing functionality
 */

// Main service
export { processDocument, shouldQueueLlmJob, shutdownOcrService } from './ocr.service';
export type { ProcessDocumentOptions, OcrProcessingResult, DocumentCategory, ExtractedMetadata } from './ocr.service';

// Image preprocessing
export { preprocessImage, getImageSize, isProcessableImage, validateImageForOcr } from './image-preprocessor';

// Text detection
export { detectTextPresence, shouldFlagForReview, shouldSkipLlmProcessing } from './text-detector';

// Metadata extraction
export { extractMetadata, extractDates, extractCompanies, extractCurrencyValues, extractPercentages } from './metadata-extractor';

// Category classification
export { classifyDocument, classifyNonTextImage, getCategoryDescription } from './category-classifier';

// Tesseract client
export { recognizeText, terminateWorker, isWorkerInitialized } from './tesseract.client';

// Types
export type { ImageSize, TextDetectionResult, TesseractOutput, CurrencyValue, PreprocessingOptions } from './types';
export { TEXT_DETECTION_THRESHOLDS, OCR_LIMITS } from './types';

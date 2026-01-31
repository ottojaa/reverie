/**
 * OCR Pipeline
 *
 * Exports for OCR processing functionality
 */

// Main service
export { processDocument, shouldQueueLlmJob, shutdownOcrService } from './ocr.service';
export type { DocumentCategory, ExtractedMetadata, OcrProcessingResult, ProcessDocumentOptions } from './ocr.service';

// Image preprocessing
export { getImageSize, isProcessableImage, preprocessImage, validateImageForOcr } from './image-preprocessor';

// Text detection
export { detectTextPresence, shouldFlagForReview, shouldSkipLlmProcessing } from './text-detector';

// Metadata extraction
export { extractCompanies, extractCurrencyValues, extractDates, extractMetadata, extractPercentages } from './metadata-extractor';

// Category classification
export { classifyDocument, classifyNonTextImage, getCategoryDescription } from './category-classifier';

// Tesseract client
export { isWorkerInitialized, recognizeText, terminateWorker } from './tesseract.client';

// Types
export { OCR_LIMITS, TEXT_DETECTION_THRESHOLDS } from './types';
export type { CurrencyValue, ImageSize, PreprocessingOptions, TesseractOutput, TextDetectionResult } from './types';

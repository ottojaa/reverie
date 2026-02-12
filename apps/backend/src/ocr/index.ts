/**
 * OCR Pipeline
 *
 * Exports for OCR processing functionality
 */

// Main service
export { processDocument, shouldQueueLlmJob, shutdownOcrService } from './ocr.service';
export type { DocumentCategory, OcrProcessingResult, ProcessDocumentOptions } from './ocr.service';

// Image preprocessing
export { getImageSize, isProcessableImage, preprocessImage, validateImageForOcr } from './image-preprocessor';

// Text detection
export { detectTextPresence, shouldFlagForReview, shouldSkipLlmProcessing } from './text-detector';

// Category classification (non-text images only)
export { classifyNonTextImage, getCategoryDescription } from './category-classifier';

// OCR clients
export { recognizeText as recognizeWithPaddleOcr } from './paddleocr.client';
export { isWorkerInitialized, recognizeText as recognizeWithTesseract, terminateWorker } from './tesseract.client';

// Types
export { OCR_LIMITS, TEXT_DETECTION_THRESHOLDS } from './types';
export type { ImageSize, OcrEngine, OcrOutput, PreprocessingOptions, TextDetectionResult } from './types';

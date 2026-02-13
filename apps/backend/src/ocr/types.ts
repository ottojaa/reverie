/**
 * OCR Pipeline Types
 */

import type { DocumentCategory } from '@reverie/shared';

// Re-export DocumentCategory from shared lib for convenience
export type { DocumentCategory };

/**
 * Supported OCR engines
 */
export type OcrEngine = 'paddleocr' | 'tesseract';

/**
 * Unified OCR output from any engine
 */
export interface OcrOutput {
    text: string;
    confidence: number;
    /** Engine identifier with version, e.g. "paddleocr/PP-OCRv4" or "tesseract/5.x-fin+eng" */
    engine: string;
}

/**
 * Image dimensions for processing
 */
export interface ImageSize {
    width: number;
    height: number;
}

/**
 * Text detection analysis result
 */
export interface TextDetectionResult {
    hasMeaningfulText: boolean;
    textDensity: number; // chars per 1000 pixels²
    confidenceScore: number;
    rawTextLength: number;
    reason?: 'low_density' | 'low_confidence' | 'short_text' | 'valid' | 'high_confidence_bypass';
}

/**
 * Full OCR processing result
 */
export interface OcrProcessingResult {
    rawText: string;
    confidenceScore: number;
    textDensity: number;
    hasMeaningfulText: boolean;
    category: DocumentCategory;
    needsReview: boolean;
    /** Which OCR engine produced this result, e.g. "paddleocr/PP-OCRv4" */
    ocrEngine: string;
}

/**
 * Pre-processing options for images
 */
export interface PreprocessingOptions {
    /** Minimum width to upscale small images to (for better OCR accuracy) */
    targetMinWidth?: number | undefined;
    /** Maximum longest side — downscale images exceeding this to speed up OCR */
    targetMaxDimension?: number | undefined;
    grayscale?: boolean | undefined;
    normalizeContrast?: boolean | undefined;
    sharpen?: boolean | undefined;
    removeNoise?: boolean | undefined;
}

/**
 * Thresholds for text detection
 */
export const TEXT_DETECTION_THRESHOLDS = {
    /** Minimum characters per 1000px². Calibrated for screenshots (≈0.3–0.5) vs photos with stray text like logos (≈0.01) */
    minTextDensity: 0.1,
    /** When confidence >= this AND text length >= highConfidenceMinLength, bypass density check (screenshots with sparse UI layout) */
    highConfidenceBypass: 80,
    highConfidenceMinLength: 100,
    /** Minimum OCR confidence to consider reliable */
    minConfidence: 40,
    /** Minimum raw text length to consider meaningful */
    minTextLength: 20,
    /** Confidence below which to skip LLM processing */
    llmSkipThreshold: 30,
    /** Confidence below which to flag for review */
    reviewThreshold: 60,
} as const;

/**
 * Resource limits for OCR processing
 */
export const OCR_LIMITS = {
    /** Maximum image size in bytes (10MB) */
    maxFileSize: 10 * 1024 * 1024,
    /** Target minimum width for OCR (upscale small images) */
    targetMinWidth: 2000,
    /** Maximum longest side in pixels — images exceeding this are downscaled before OCR */
    targetMaxDimension: 4000,
    /** Maximum processing time per image in ms */
    maxProcessingTime: 60000,
} as const;

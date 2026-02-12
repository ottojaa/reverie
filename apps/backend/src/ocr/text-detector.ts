import type { ImageSize, OcrOutput, TextDetectionResult } from './types';
import { TEXT_DETECTION_THRESHOLDS } from './types';

/**
 * Text Detector
 *
 * Analyzes OCR output to determine if an image contains meaningful text
 * vs being a photo, graphic, or other non-textual content.
 */

/**
 * Detect if OCR output contains meaningful text
 *
 * Uses multiple heuristics:
 * 1. Text density (characters per 1000 pixels²)
 * 2. OCR confidence score
 * 3. Raw text length
 * 4. Text quality analysis
 */
export function detectTextPresence(ocrOutput: OcrOutput, imageSize: ImageSize): TextDetectionResult {
    const { text, confidence } = ocrOutput;
    const { width, height } = imageSize;

    // Calculate text density: characters per 1000 pixels²
    const imageArea = width * height;
    const textDensity = imageArea > 0 ? (text.length / imageArea) * 1000 : 0;

    // Clean text (remove whitespace-only content)
    const cleanedText = text.trim();
    const rawTextLength = cleanedText.length;

    // Determine if meaningful text exists based on thresholds
    let hasMeaningfulText = false;
    let reason: TextDetectionResult['reason'] = undefined;

    const highConfidenceBypass =
        confidence >= TEXT_DETECTION_THRESHOLDS.highConfidenceBypass &&
        rawTextLength >= TEXT_DETECTION_THRESHOLDS.highConfidenceMinLength;

    if (rawTextLength < TEXT_DETECTION_THRESHOLDS.minTextLength) {
        reason = 'short_text';
    } else if (confidence < TEXT_DETECTION_THRESHOLDS.minConfidence) {
        reason = 'low_confidence';
    } else if (!highConfidenceBypass && textDensity < TEXT_DETECTION_THRESHOLDS.minTextDensity) {
        reason = 'low_density';
    } else {
        hasMeaningfulText = true;
        reason = highConfidenceBypass ? 'high_confidence_bypass' : 'valid';
    }

    return {
        hasMeaningfulText,
        textDensity,
        confidenceScore: confidence,
        rawTextLength,
        reason,
    };
}

/**
 * Check if OCR result should be flagged for manual review
 */
export function shouldFlagForReview(confidenceScore: number, hasMeaningfulText: boolean): boolean {
    // Flag for review if confidence is below threshold but text was detected
    return hasMeaningfulText && confidenceScore < TEXT_DETECTION_THRESHOLDS.reviewThreshold;
}

/**
 * Check if OCR result should skip LLM processing
 */
export function shouldSkipLlmProcessing(confidenceScore: number, hasMeaningfulText: boolean): boolean {
    // Skip if no meaningful text or confidence is too low
    return !hasMeaningfulText || confidenceScore < TEXT_DETECTION_THRESHOLDS.llmSkipThreshold;
}

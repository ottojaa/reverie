import type { ImageSize, TextDetectionResult, TesseractOutput } from './types';
import { TEXT_DETECTION_THRESHOLDS } from './types';

/**
 * Text Detector (Plan 05)
 *
 * Analyzes OCR output to determine if an image contains meaningful text
 * vs being a photo, graphic, or other non-textual content.
 */

/**
 * Detect if OCR output contains meaningful text
 *
 * Uses multiple heuristics:
 * 1. Text density (characters per 1000 pixels²)
 * 2. Tesseract confidence score
 * 3. Raw text length
 * 4. Text quality analysis
 */
export function detectTextPresence(ocrOutput: TesseractOutput, imageSize: ImageSize): TextDetectionResult {
    const { text, confidence } = ocrOutput;
    const { width, height } = imageSize;

    // Calculate text density: characters per 1000 pixels²
    const imageArea = width * height;
    const textDensity = imageArea > 0 ? (text.length / imageArea) * 1000 : 0;

    // Clean text (remove whitespace-only content)
    const cleanedText = text.trim();
    const rawTextLength = cleanedText.length;

    // Check if text is gibberish (random characters, OCR noise)
    const isGibberish = checkForGibberish(cleanedText);

    // Determine if meaningful text exists based on thresholds
    let hasMeaningfulText = false;
    let reason: TextDetectionResult['reason'] = undefined;

    if (rawTextLength < TEXT_DETECTION_THRESHOLDS.minTextLength) {
        reason = 'short_text';
    } else if (confidence < TEXT_DETECTION_THRESHOLDS.minConfidence) {
        reason = 'low_confidence';
    } else if (textDensity < TEXT_DETECTION_THRESHOLDS.minTextDensity) {
        reason = 'low_density';
    } else if (isGibberish) {
        reason = 'low_confidence'; // Gibberish treated as low quality
    } else {
        hasMeaningfulText = true;
        reason = 'valid';
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
 * Check if text appears to be gibberish/noise rather than real content
 *
 * Heuristics:
 * - Too many consecutive consonants (unlikely in real text)
 * - Very low ratio of common words
 * - Excessive special characters
 */
function checkForGibberish(text: string): boolean {
    if (text.length < 20) return false; // Too short to determine

    // Check for excessive non-letter characters
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    const letterRatio = letterCount / text.length;

    // Real text should be mostly letters
    if (letterRatio < 0.5) return true;

    // Check for unrealistic consonant clusters
    const consonantClusters = text.match(/[bcdfghjklmnpqrstvwxz]{5,}/gi) || [];
    if (consonantClusters.length > text.length / 50) return true;

    // Check for common English words
    const words = text.toLowerCase().split(/\s+/);
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'this', 'that', 'it', 'be', 'have', 'has', 'had', 'not', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their']);

    let commonWordCount = 0;
    for (const word of words) {
        if (commonWords.has(word)) {
            commonWordCount++;
        }
    }

    // If we have enough words but almost no common words, likely gibberish
    if (words.length > 10 && commonWordCount / words.length < 0.05) {
        return true;
    }

    return false;
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

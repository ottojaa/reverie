/**
 * LLM Eligibility Checker
 *
 * Determines whether a document should be processed by LLM
 * and which processing type to use.
 */

import { env } from '../config/env';
import type { Document, OcrResult } from '../db/schema';
import type { FileCategory, LlmEligibility, LlmSkipReason } from './types';

/**
 * Check if a document is eligible for LLM processing
 */
export function checkLlmEligibility(document: Document, ocrResult?: OcrResult | null): LlmEligibility {
    // 1. Check if LLM is enabled globally
    if (!env.LLM_ENABLED) {
        return {
            eligible: false,
            reason: 'llm_disabled',
            processingType: 'skip',
        };
    }

    // 2. Check file type
    const category = getFileCategory(document.mime_type);

    if (category === 'binary' || category === 'media') {
        return {
            eligible: false,
            reason: 'unsupported_file_type',
            processingType: 'skip',
        };
    }

    if (category === 'code') {
        // Code files: optional, usually skip
        if (!env.LLM_PROCESS_CODE_FILES) {
            return {
                eligible: false,
                reason: 'code_file_skipped',
                processingType: 'skip',
            };
        }
    }

    // 3. Check for images without text
    if (category === 'image' && !document.has_meaningful_text) {
        if (env.LLM_VISION_ENABLED) {
            return {
                eligible: true,
                processingType: 'vision_describe',
            };
        }
        return {
            eligible: false,
            reason: 'no_text_no_vision',
            processingType: 'skip',
        };
    }

    // 4. Check text content
    const textLength = ocrResult?.raw_text?.length ?? 0;

    if (textLength === 0) {
        // For images, try vision if available
        if (category === 'image' && env.LLM_VISION_ENABLED) {
            return {
                eligible: true,
                processingType: 'vision_describe',
            };
        }
        return {
            eligible: false,
            reason: 'no_text_content',
            processingType: 'skip',
        };
    }

    // 5. Check OCR confidence (for OCR'd content)
    if (ocrResult && ocrResult.confidence_score !== null && ocrResult.confidence_score < env.LLM_MIN_OCR_CONFIDENCE) {
        return {
            eligible: false,
            reason: 'ocr_confidence_too_low',
            processingType: 'skip',
            warnings: [
                `OCR confidence (${ocrResult.confidence_score}%) below minimum (${env.LLM_MIN_OCR_CONFIDENCE}%), skipping LLM to avoid garbage-in-garbage-out`,
            ],
        };
    }

    // Eligible for text summary
    // Note: We never skip due to size - we sample instead
    const warnings: string[] = [];
    if (textLength > env.LLM_MAX_INPUT_CHARS) {
        warnings.push(`Text will be sampled from ${textLength} to ~${env.LLM_MAX_INPUT_CHARS} chars`);
    }

    return {
        eligible: true,
        processingType: 'text_summary',
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}

/**
 * Categorize a file by its MIME type
 */
export function getFileCategory(mimeType: string): FileCategory {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'media';
    if (mimeType === 'application/pdf') return 'document';
    if (mimeType.startsWith('application/vnd.openxmlformats')) return 'document'; // Office docs
    if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/csv') return 'text';

    // Code files
    if (
        mimeType.includes('javascript') ||
        mimeType.includes('typescript') ||
        mimeType.includes('python') ||
        mimeType.includes('java') ||
        mimeType === 'text/x-python' ||
        mimeType === 'application/json'
    ) {
        return 'code';
    }

    // Binary catch-all
    if (mimeType.startsWith('application/')) return 'binary';

    // Default to text for unknown
    return 'text';
}

/**
 * Build skip metadata for documents that won't be processed
 */
export function buildSkipMetadata(reason: LlmSkipReason, textLength?: number, warnings?: string[]): Record<string, unknown> {
    return {
        skipped: true,
        skip_reason: reason,
        skipped_at: new Date().toISOString(),
        original_text_length: textLength,
        warnings,
    };
}

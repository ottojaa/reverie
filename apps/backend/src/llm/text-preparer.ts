/**
 * Text Preparation Utilities (Plan 06)
 *
 * Handles text sampling strategies for large documents to fit within
 * LLM token limits while preserving document understanding.
 */

import { env } from '../config/env';
import type { PreparedText, SamplingStrategy } from './types';

/**
 * Prepare text for LLM processing with smart sampling for large documents
 *
 * Strategies:
 * - full: Text fits within limits, use as-is
 * - start_end: Medium files (50K-500K), sample beginning, middle, and end
 * - distributed: Very large files (>500K), take evenly distributed snippets
 */
export function prepareTextForLlm(rawText: string): PreparedText {
    const maxChars = env.LLM_MAX_INPUT_CHARS;
    const veryLargeThreshold = 500_000;

    // Small files: use full text
    if (rawText.length <= maxChars) {
        return {
            text: rawText,
            truncated: false,
            samplingStrategy: 'full',
            originalLength: rawText.length,
            sampledSections: 1,
        };
    }

    // Medium files (50K - 500K): beginning + middle + end
    if (rawText.length <= veryLargeThreshold) {
        return sampleStartMiddleEnd(rawText, maxChars);
    }

    // Very large files (>500K): distributed sampling
    return sampleDistributed(rawText, maxChars);
}

/**
 * Sample from start, middle, and end of document
 * Good for medium-sized files where structure matters
 */
function sampleStartMiddleEnd(text: string, maxChars: number): PreparedText {
    const startSize = Math.floor(maxChars * 0.5); // 50% from beginning
    const middleSize = Math.floor(maxChars * 0.25); // 25% from middle
    const endSize = Math.floor(maxChars * 0.2); // 20% from end
    // Reserve ~5% for separator text

    const middleStart = Math.floor(text.length / 2) - Math.floor(middleSize / 2);
    const gapBeforeMiddle = middleStart - startSize;
    const gapAfterMiddle = text.length - (middleStart + middleSize) - endSize;

    const sampledText = [
        text.slice(0, startSize),
        `\n\n[... ${(gapBeforeMiddle / 1000).toFixed(0)}K chars omitted ...]\n\n`,
        text.slice(middleStart, middleStart + middleSize),
        `\n\n[... ${(gapAfterMiddle / 1000).toFixed(0)}K chars omitted ...]\n\n`,
        text.slice(-endSize),
    ].join('');

    return {
        text: sampledText,
        truncated: true,
        samplingStrategy: 'start_end',
        originalLength: text.length,
        sampledSections: 3,
    };
}

/**
 * Take evenly distributed snippets throughout the document
 * Best for very large files where we need representative samples
 */
function sampleDistributed(text: string, maxChars: number): PreparedText {
    const snippetSize = env.LLM_SNIPPET_SIZE;
    const numSnippets = Math.floor(maxChars / snippetSize);
    const spacing = Math.floor(text.length / numSnippets);

    const snippets: string[] = [];
    for (let i = 0; i < numSnippets; i++) {
        const start = i * spacing;
        const snippet = text.slice(start, start + snippetSize);
        const position = ((start / text.length) * 100).toFixed(0);
        snippets.push(`[Section at ${position}% of document]\n${snippet}`);
    }

    const sampledText = [
        `[Document is ${(text.length / 1000).toFixed(0)}K chars. Showing ${numSnippets} distributed samples:]\n\n`,
        snippets.join('\n\n[...]\n\n'),
    ].join('');

    return {
        text: sampledText,
        truncated: true,
        samplingStrategy: 'distributed',
        originalLength: text.length,
        sampledSections: numSnippets,
    };
}

/**
 * Build prompt context that informs the LLM about sampling
 */
export function buildPromptWithSamplingContext(prepared: PreparedText): string {
    if (!prepared.truncated) {
        return prepared.text;
    }

    const contextNote =
        prepared.samplingStrategy === 'distributed'
            ? `Note: This is a very large document (${(prepared.originalLength / 1000).toFixed(0)}K chars). ` +
              `You are seeing ${prepared.sampledSections} representative samples from throughout the document. ` +
              `Infer the overall theme and purpose from these samples.`
            : `Note: This document has been truncated from ${(prepared.originalLength / 1000).toFixed(0)}K chars. ` +
              `You are seeing the beginning, middle, and end sections.`;

    return `${contextNote}\n\n---\n\n${prepared.text}`;
}

/**
 * Estimate token count from character count
 * Rough approximation: ~4 chars per token for English text
 */
export function estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
}

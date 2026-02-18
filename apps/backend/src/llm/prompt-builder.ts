/**
 * Prompt Builder
 *
 * Constructs prompts for LLM document processing.
 * Designed for OCR-extracted text with potential recognition errors.
 * Supports multilingual documents (Finnish/English).
 */

import { env } from '../config/env';
import type { Document, OcrResult } from '../db/schema';
import { buildPromptWithSamplingContext } from './text-preparer';
import type { LlmPrompt, PreparedText } from './types';

/**
 * System message for document analysis
 *
 * Key design decisions:
 * - Explicitly warns about OCR artifacts
 * - Instructs preservation of proper nouns
 * - Requests comprehensive structured extraction
 * - Handles multilingual content (Finnish/English)
 */
const SYSTEM_MESSAGE = `
You analyze OCR text from scanned documents and return strict JSON only.

Core principles:
- OCR text may contain noise (0↔O, 1↔I, missing letters, spacing errors).
- Extract structured facts without inventing new information.
- Never guess missing data.

Entity rules:
- Always preserve the exact OCR string in "raw_text".
- "canonical_name" may fix obvious single-character OCR errors (0/O, 1/I, l/I).
- canonical_name may restore a single missing trailing character when the word strongly resembles a common organization name.
- Do not invent new entity names.
- For person names: do not modify surname structure or guess corrections.
- Do not include numeric identifiers inside organization names.
- Extract account numbers, references, and IDs separately as entities of type "identifier" or in key_values.
- If unsure about normalization, keep canonical_name equal to raw_text and set confidence to "low".
- Street addresses and postal codes must be classified as type "location", not organization.

Return JSON with these fields when present:
{
  "summary": "2-3 sentence English summary",
  "title": "5-10 word English title",
  "document_type": "receipt|invoice|statement|letter|contract|form|certificate|report|securities_statement|tax_document|bank_statement|insurance|medical|memo|newsletter|other",
  "entities": [
    {
      "type": "person|organization|location|product|account|identifier|contact",
      "canonical_name": "...",
      "raw_text": "...",
    }
  ],
  "topics": [],
  "extracted_date": "YYYY-MM-DD",
}

Extraction rules:
- Extract only meaningful, referential entities.
- Do NOT extract standalone numeric values, monetary amounts, or balances unless labeled with clear meaning.
- Identifiers must uniquely identify an account, document, transaction, or party.
- Street addresses and postal codes are type "location".
- Prefer under-extraction to over-extraction.
- Do not output empty fields.
`;


/**
 * Vision system message for image description
 */
const VISION_PROMPT = `Describe this image in 2-3 sentences. Include:
- What the image shows (people, places, objects, scenes)
- Any notable details or context
- If it's a screenshot, describe the app/content shown

Be concise and factual.`;

interface BuildPromptContext {
    document: Document;
    ocrResult?: OcrResult | null;
    preparedText: PreparedText;
}

/**
 * Build the prompt for document text summarization
 */
export function buildDocumentPrompt(context: BuildPromptContext): LlmPrompt {
    const { document, ocrResult, preparedText } = context;

    // Build OCR text with sampling context if needed
    const textForPrompt = buildPromptWithSamplingContext(preparedText);

    // Build confidence context
    const confidenceNote = ocrResult?.confidence_score
        ? `\nOCR confidence: ${ocrResult.confidence_score}% (${ocrResult.confidence_score < 60 ? 'low -- expect more errors' : ocrResult.confidence_score < 80 ? 'moderate -- some errors likely' : 'high'})`
        : '';

    // Construct user message
    const userMessage = `Document filename: "${document.original_filename}"${confidenceNote}

OCR-extracted text:
---
${textForPrompt}
---

Analyze this document and extract all structured information as specified. Pay special attention to tabular data, financial figures, and proper nouns.`;

    return {
        system: SYSTEM_MESSAGE,
        user: userMessage,
        maxTokens: env.OPENAI_MAX_TOKENS,
    };
}

/**
 * Get the vision prompt for image description
 */
export function getVisionPrompt(): string {
    return VISION_PROMPT;
}

/**
 * Build a simple fallback summary when LLM is unavailable
 */
export function buildFallbackSummary(document: Document, ocrResult?: OcrResult | null): string {
    const parts: string[] = [];

    if (document.document_category) {
        parts.push(`Document type: ${document.document_category}`);
    }

    if (document.extracted_date) {
        const date = new Date(document.extracted_date);
        parts.push(`Date: ${date.toLocaleDateString()}`);
    }

    if (ocrResult?.raw_text) {
        const preview = ocrResult.raw_text.slice(0, 200).replace(/\s+/g, ' ').trim();

        if (preview) {
            parts.push(`Preview: "${preview}..."`);
        }
    }

    if (parts.length === 0) {
        return `Document: ${document.original_filename}`;
    }

    return parts.join('. ');
}

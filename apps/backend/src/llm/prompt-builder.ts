/**
 * Prompt Builder
 *
 * Constructs prompts for LLM document processing.
 * Designed for OCR-extracted text with potential recognition errors.
 * Supports multilingual documents (Finnish/English).
 */

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
const SYSTEM_MESSAGE = `You are a document analysis assistant that processes text extracted from scanned documents via OCR.

IMPORTANT CONTEXT:
- The input text comes from OCR (optical character recognition) and may contain recognition errors such as garbled characters, misread letters, merged or split words, and misplaced whitespace.
- Use surrounding context to infer correct readings when OCR errors are apparent.
- Documents may be in Finnish, English, or a mix of both languages.
- CRITICAL: Preserve proper nouns (names of people, companies, places) as accurately as possible. Only correct a proper noun if you are highly confident it is an OCR error AND the correct form appears elsewhere in the document or is unambiguously inferable from context. Never guess or hallucinate corrections to names.

YOUR TASK:
Analyze the OCR-extracted document text and produce a comprehensive structured extraction.

OUTPUT FORMAT (strict JSON):
{
  "summary": "2-3 sentence description of the document's purpose and key content. Be specific about what the document contains.",
  "title": "Concise document title, 5-10 words",
  "document_type": "One of: receipt, invoice, statement, letter, contract, form, certificate, report, securities_statement, tax_document, bank_statement, insurance, medical, memo, newsletter, other",
  "language": "Primary language code (e.g. 'fi', 'en', 'fi/en' for mixed)",
  "key_entities": {
    "people": ["Full names of people mentioned in the document"],
    "organizations": ["Companies, banks, institutions, authorities mentioned"],
    "locations": ["Cities, addresses, countries mentioned"]
  },
  "topics": ["Main themes/topics as keywords"],
  "extracted_dates": ["All dates found, normalized to YYYY-MM-DD format"],
  "key_values": [
    {"label": "Descriptive label for the value", "value": "The extracted value with original units/currency"}
  ],
  "sentiment": "neutral",
  "table_data": [
    {"item": "Row identifier/name", "columns": {"column_name": "value", "another_column": "value"}}
  ]
}

EXTRACTION GUIDELINES:
- summary: Be specific about the document's purpose. For financial documents, mention the account holder and the nature of the statement. For letters, mention the sender, recipient, and topic.
- key_values: Extract ALL significant named values including account numbers, reference numbers, totals, subtotals, conversion rates, service numbers, and any other labeled values. Preserve the original currency symbols and number formats.
- table_data: If the document contains tabular data (e.g. stock holdings, transaction lists, line items), extract EVERY row as a structured object. Use the header labels as column keys. This is critical for financial documents.
- extracted_dates: Normalize all dates to YYYY-MM-DD format. For European date formats (DD.MM.YYYY), parse correctly.
- key_entities.organizations: Include company names, stock names, bank names, and other institutions even if abbreviated or in a table.
- Do not include empty arrays or null values in the output -- omit the field instead.`;

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
        maxTokens: 2000,
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

/**
 * Prompt Builder
 *
 * Constructs prompts for LLM document processing.
 * Prompts are generic to handle diverse document types.
 */

import type { Document, OcrMetadata, OcrResult } from '../db/schema';
import { buildPromptWithSamplingContext } from './text-preparer';
import type { LlmPrompt, PreparedText } from './types';

/**
 * System message for document analysis (generic for all document types)
 */
const SYSTEM_MESSAGE = `You are a document analysis assistant. Your task is to analyze text extracted from a document via OCR and provide a structured summary.

Your goals:
- Generate a concise, human-readable summary (2-3 sentences)
- Extract key entities (people, organizations, places)
- Identify main topics or themes
- Suggest a document type/category
- Extract important information that would be useful for searching

Be factual and concise. Avoid speculation.`;

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

    // Build metadata context
    const metadataContext = buildMetadataContext(ocrResult);

    // Construct user message
    const userMessage = `Document: "${document.original_filename}"
OCR Text:
---
${textForPrompt}
---
${metadataContext}

Based on this document, generate:
1. A 2-3 sentence summary of what this document is about
2. A suggested title for the document (5-10 words)
3. Key entities mentioned (people, organizations, places)
4. Main topics or themes
5. A document type/category
6. Any additional important information for indexing

Respond in JSON format:
{
  "summary": "Brief description of the document contents...",
  "title": "Suggested Document Title",
  "key_entities": ["Entity 1", "Entity 2"],
  "topics": ["topic1", "topic2"],
  "document_type": "category_name",
  "key_values": [
    { "label": "context for value", "value": "extracted value" }
  ],
  "sentiment": "neutral",
  "additional_dates": ["2023-06-01"]
}`;

    return {
        system: SYSTEM_MESSAGE,
        user: userMessage,
        maxTokens: 500,
    };
}

/**
 * Build metadata context from OCR result
 */
function buildMetadataContext(ocrResult?: OcrResult | null): string {
    if (!ocrResult?.metadata) {
        return '';
    }

    const metadata = ocrResult.metadata as OcrMetadata;
    const parts: string[] = ['OCR Metadata (already extracted):'];

    if (metadata.dates && metadata.dates.length > 0) {
        parts.push(`- Detected dates: ${metadata.dates.join(', ')}`);
    }

    if (metadata.companies && metadata.companies.length > 0) {
        parts.push(`- Companies: ${metadata.companies.join(', ')}`);
    }

    if (metadata.values && metadata.values.length > 0) {
        const valueStrs = metadata.values.map((v) => `${v.currency}${v.amount}`);
        parts.push(`- Extracted values: ${valueStrs.join(', ')}`);
    }

    if (ocrResult.confidence_score) {
        parts.push(`- OCR confidence: ${ocrResult.confidence_score}%`);
    }

    if (parts.length === 1) {
        return ''; // No metadata to show
    }

    return '\n' + parts.join('\n');
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

    // Document type
    if (document.document_category) {
        parts.push(`Document type: ${document.document_category}`);
    }

    // Date info
    if (document.extracted_date) {
        const date = new Date(document.extracted_date);
        parts.push(`Date: ${date.toLocaleDateString()}`);
    }

    // OCR metadata
    if (ocrResult?.metadata) {
        const metadata = ocrResult.metadata as OcrMetadata;

        if (metadata.companies && metadata.companies.length > 0) {
            parts.push(`Companies: ${metadata.companies.join(', ')}`);
        }
    }

    // Text preview
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

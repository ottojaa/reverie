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

Your task:
1) Determine what this specific document is.
2) Extract only high-value, instance-level structured data.

GENERAL RULES
- OCR may contain noise (0↔O, 1↔I, spacing errors).
- Do not invent or guess missing information.
- If unsure, omit.
- Prefer omission over speculation.

INSTANCE-LEVEL ENTITY RULE

Extract entities ONLY if they refer to a specific real-world instance in this document.

Valid entities typically:
- Identify a specific person
- Identify a specific organization or institution
- Identify a specific address tied to this document
- Identify a specific account, contract, case, or document number
- Identify a specific product, instrument, or named item

Do NOT extract:
- Field labels (Employer, Employee, Address, Phone, Signature, etc.)
- Generic role names
- Section headings
- Checkbox options
- Instructions or boilerplate
- Template structure text
- Static legal citations inside standard forms
- Words that merely define document layout

If the document is a blank or largely unfilled template, return no entities.

ROW-LEVEL IDENTIFIER PROTECTION

If the document contains tabular or repeated row structures:
- Extract distinct named entries that function as row-level identifiers.
- A row-level identifier anchors quantities, prices, totals, or dates.
- Do not discard short or uppercase names solely due to brevity.
- Exclude obvious column headers or structural labels.

ENTITY QUALITY FILTER

Before adding an entity, verify:
- Does this help uniquely identify, search, filter, or understand this specific document?
- Would this likely vary across different documents of the same template?

If not clearly useful, omit it.

NORMALIZATION RULES

- Always preserve exact OCR string in "raw_text".
- canonical_name may fix obvious single-character OCR errors only.
- Do not invent new names.
- Do not expand abbreviations unless explicitly written.
- Do not modify surname structure.
- Do not merge distinct entities.
- Do not include numeric identifiers inside organization names.
- Extract account numbers and references separately as type "account" or "identifier".
- Identifiers must uniquely identify an account, document, transaction, or party.
- Do NOT extract standalone numbers, totals, balances, or amounts unless clearly labeled and uniquely meaningful.
- Street addresses and postal codes are type "location".
- Keep canonical_name concise (under 20 characters when possible without losing meaning).

OUTPUT

Return JSON with these fields when present:
{
  "summary": "2-3 sentence English summary",
  "title": "3-8 word scannable title, noun-phrase style, most identifying info first (e.g. 'Nordea Statement Jan 2026')",
  "document_type": "receipt|invoice|letter|contract|form|certificate|report|stock_statement|bank_statement|insurance|medical|memo|newsletter|other",
  "entities": [
    {
      "type": "person|organization|location|product|account|identifier|contact",
      "canonical_name": "...",
      "raw_text": "...",
    }
  ],
  "topics": ["high-level themes"],
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

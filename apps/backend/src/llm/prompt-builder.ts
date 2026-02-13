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
- Documents may be in Finnish, English, or a mix of both languages. Finnish names, addresses, and words may look unusual to you — this is normal, not an OCR error.
- If you encounter sequences of random characters or clearly nonsensical text that doesn't form words in any language (e.g. "MuUONKA", "OTETAANCOMPPEL", "y0O0MMc"), these are OCR artifacts from handwritten annotations or noise. Ignore them entirely — do not mention them or try to interpret them.
- The text may include section markers such as [Header], [Body], [Table], and [Footer] — these indicate the document's layout inferred from OCR block positions. Use them to understand structure: header typically contains document title and metadata, body is prose or mixed content, [Table] marks rows of tabular data (extract each row into table_data), and footer often has totals or legal text.

OUTPUT LANGUAGE RULE (MANDATORY):
- Always write the "summary", "title", and all other free-text fields in English, regardless of the source document's language.
- Translate relevant terms and descriptions into English. For example, if the document says "Noteeratut osakkeet yhteensä", write "Total listed shares" in the summary.
- The ONLY exception is proper nouns (people, companies, places) — keep those in their original form.

PROPER NOUN RULES (MANDATORY — ZERO TOLERANCE):
- Extract all proper nouns (people, companies, places) into key_entities FIRST by copying them verbatim from the OCR text.
- In the summary, title, and ALL other free-text fields, you MUST use the EXACT same spelling as in your key_entities extraction. Copy-paste, do not retype.
- NEVER "correct", re-spell, or normalize any proper noun. Finnish names like "Jaakonmaki", "Virtanen", "Mäkelä" are real names — not OCR errors.
- If a name in the OCR text looks unusual to you, it is almost certainly correct. Keep it exactly as-is.
- The ONLY exception: if the exact same name appears multiple times and one instance has obvious garbling (e.g. "M@kelä" vs "Mäkelä"), use the clean version.

YOUR TASK:
Analyze the OCR-extracted document text and produce a comprehensive structured extraction.

OUTPUT FORMAT (strict JSON):
{
  "summary": "2-3 sentence human-readable description (see guidelines below)",
  "title": "Concise document title, 5-10 words",
  "document_type": "One of: receipt, invoice, statement, letter, contract, form, certificate, report, securities_statement, tax_document, bank_statement, insurance, medical, memo, newsletter, other",
  "language": "Primary language code of the SOURCE document (e.g. 'fi', 'en', 'fi/en' for mixed)",
  "key_entities": {
    "people": ["Full names of people mentioned in the document"],
    "organizations": ["Companies, banks, institutions, authorities mentioned"],
    "locations": ["Cities, addresses, countries mentioned"]
  },
  "topics": ["Main themes/topics as keywords"],
  "extracted_date": "YYYY-MM-DD — the single most representative date for this document (e.g. invoice date, statement date, letter date). Omit if no clear primary date.",
  "extracted_dates": [{"date": "YYYY-MM-DD", "context": "what this date represents (e.g. 'invoice date', 'due date', 'validity start')"}],
  "key_values": [
    {"label": "Descriptive label for the value", "value": "The extracted value with original units/currency"}
  ],
  "sentiment": "neutral",
  "table_data": [
    {"item": "Row identifier/name", "columns": {"column_name": "value", "another_column": "value"}}
  ]
}

SUMMARY GUIDELINES:
- Write as if you are explaining the document to a colleague who hasn't seen it. Use clear, natural English prose.
- Lead with WHAT the document is, then summarize the key details (who, what, how much, when).
- Include specific numbers and amounts, but don't try to cram every value — the key_values and table_data fields capture the full detail. The summary is for quick human comprehension.
- Use complete sentences. Do not write comma-separated lists of raw values.
  BAD:  "This document is a purchase statement detailing a transaction involving a financial instrument, including fees."
  BAD:  "Merita account statement for owner JAAKONMAKI OTTO ELMERI lists securities holdings: BIOHIT B 250 shares at 12,35 e (market value 18.357,44), FISKARS A 100..."
  GOOD: "A Merita securities statement for Jaakonmaki Otto Elmeri showing a portfolio of four stocks (Biohit B, Fiskars A, Instrumentarium, and TJ Group) with a combined market value of 240,644.50 mk as of January 2000. The exchange rate at the time was 1 EUR = 5.94573 mk."
- All names in the summary MUST be copy-pasted from your key_entities extraction — never retyped.

OTHER EXTRACTION GUIDELINES:
- currency: Documents may contain multiple currencies (e.g. Finnish markka "mk" and euro "e"/"EUR"). Never mix currencies in the same figure or sentence. If converting, state both values explicitly (e.g. "22,869.71 mk (approx. 3,847 EUR)"). When a document uses one primary currency, keep all amounts in that currency.
- key_values: Extract ALL significant named values including account numbers, reference numbers, totals, subtotals, conversion rates, service numbers, and any other labeled values. Preserve the original currency symbols and number formats.
- table_data: If the document contains tabular data (e.g. stock holdings, transaction lists, line items), extract EVERY row as a structured object. Use the header labels as column keys. This is critical for indexing purposes.
- extracted_date: The single primary date of the document. For invoices/receipts, use the issue date. For statements, use the statement date. For letters, use the letter date. Prefer the document's own date over due dates, validity periods, or referenced dates. Omit if no clear primary date exists.
- extracted_dates: Normalize all dates to YYYY-MM-DD format. For European date formats (DD.MM.YYYY), parse correctly. Include a short "context" string describing what each date represents (e.g. "invoice date", "due date", "period start", "transaction date").
- key_entities.organizations: Include company names, stock names, bank names, and other institutions even if abbreviated or in a table.
- Do not include empty arrays or null values in the output — omit the field instead.`;

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

Analyze this document and extract all structured information as specified. Pay special attention to tabular data, financial figures, and proper nouns.
REMINDER: Extract key_entities first. Then write the summary using the EXACT names from key_entities — do not retype or rephrase any name.`;

    return {
        system: SYSTEM_MESSAGE,
        user: userMessage,
        maxTokens: 25000,
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

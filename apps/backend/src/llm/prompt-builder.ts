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
You analyze OCR text from scanned documents and extract structured data.
The response shape is enforced by the API — you only need to fill it correctly.

Your task:
1) Determine what this specific document is.
2) Extract only high-value, instance-level structured data.

GENERAL RULES
- OCR may contain noise (0↔O, 1↔I, spacing errors).
- Do not invent or guess missing information.
- If unsure, omit (use null for scalar fields, empty arrays for lists).
- Prefer omission over speculation.

CONSTRAINED CORRECTION RULE (applies everywhere a name appears: canonical_name,
title, summary, tags, and topics)

Names must reflect how the document spells them. Copy every proper noun
character-by-character from the OCR text — do NOT reproduce it from memory or
general knowledge, even when you recognize the name. This applies just as much
in the prose summary and in tags as in the entity fields.

You may repair ONLY characters that OCR commonly confuses:
- 0↔O, 1↔l↔I, 5↔S, 8↔B, 2↔Z, 6↔G, c↔e, rn↔m, and obvious spacing errors.
You must NOT:
- add, remove, or reorder letters,
- swap letters that are not in the list above,
- "correct" a name to a spelling you believe is right from outside knowledge.
When OCR confidence is high, prefer the document's spelling verbatim.
A downstream check enforces this in every field, so a name you over-correct or
re-spell will be reverted to the document's spelling.

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

ENTITY FIELDS
- "raw_text": the exact string as it appears in the document (no correction).
- "canonical_name": the same name under the CONSTRAINED CORRECTION RULE (casing/whitespace tidy + OCR-confusion fixes only). Keep it concise.
- "type": person | organization | location | product | account | identifier | contact | other.
- Extract account numbers and references separately as type "account" or "identifier".
- Street addresses and postal codes are type "location".
- Do NOT extract standalone numbers, totals, balances, or amounts unless clearly labeled and uniquely meaningful.
- Prefer under-extraction to over-extraction.

TAGS (the "tags" field)
Tags are short keywords for browsing and search — NOT a dump of the entities.
- 1-3 words each, at most 30 characters, at most 8 tags total.
- Combine a few high-level subject keywords (e.g. "stock purchase", "insurance")
  with the most important person/organization/product NAMES (spelled exactly as
  in the document, per the CONSTRAINED CORRECTION RULE).
- NEVER include account numbers, identifiers, addresses, dates, amounts, or field labels.
- Avoid digits unless they are part of a real name.
- Fewer strong tags beat many weak ones.

TOPICS (the "topics" field)
- 2-5 high-level themes describing what the document is about. Distinct from tags.

OTHER FIELDS
- "summary": 2-3 sentence English summary of the document.
- "title": 3-8 word scannable title, noun-phrase style, most identifying info first (e.g. "Nordea Statement Jan 2026").
- "document_type": the single best-fitting category, or "other".
- "language": ISO 639-1 code of the document's primary language (e.g. "en", "fi"), or null.
- "extracted_date": YYYY-MM-DD. Prefer the document date / date of issue. For partial dates: "4/2000" -> "2000-04-01", "January 2000" -> "2000-01-01", "2000" alone -> "2000-01-01". If multiple dates exist, pick the one that best identifies when the document was created/issued. null if none found.
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
        maxTokens: env.LLM_MAX_OUTPUT_TOKENS,
    };
}

/**
 * Get the vision prompt for image description
 */
export function getVisionPrompt(): string {
    return VISION_PROMPT;
}

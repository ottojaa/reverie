/**
 * Prompt for the one call that sees an image together with its OCR text. The response shape is enforced by the API
 * (LlmImageUnderstandingSchema), so the prompt only says what each field should hold.
 */
import { env } from '../config/env';
import type { OcrResult } from '../db/schema';
import type { LookKind } from './image-look';
import { buildPromptWithSamplingContext, prepareTextForLlm } from './text-preparer';
import type { LlmPrompt } from './types';

const SYSTEM_MESSAGE = `
You are shown one image from a personal document library (a screenshot, a scan or photo of a document, a receipt, or a diagram) and the text OCR found in it. The OCR text may be empty, partial or wrong.

Describe what the image is and extract structured data. The response shape is enforced by the API: fill it correctly.

GENERAL RULES
- Use the image to understand WHAT it is and what it shows; use the OCR text for exact spellings of names, numbers and codes.
- Do not invent or guess. If unsure, use null for scalar fields and empty arrays for lists.
- Do not identify anyone from their appearance. Name a person only when the text in the image names them.

FIELDS
- "kind": what the image is. Start from the kind hint in the message and change it only when the image clearly shows another: screenshot (a capture of a screen, app, website or terminal), document (a page of paper or a PDF-like page), receipt (a purchase receipt or invoice slip), diagram (a chart, drawing, schematic or illustration).
- "app_or_source": the app, site or source the image comes from, named the way a person would: "Lunamux terminal", "Gmail inbox", "Slack", "Nordea mobile app", "Postgres docs". For a paper document, the issuer or publication ("Nordea", "City of Helsinki"). At most 4 words. null when it cannot be told.
- "title": a 3-8 word scannable title, noun-phrase style, most identifying info first.
- "summary": 2-3 English sentences: what the image is, which app or source, and what it shows or says.
- "document_type": the best-fitting document type, or "other" (use "other" for a screenshot or diagram that is not a document).
- "language": ISO 639-1 code of the main language of the text in the image, or null.
- "extracted_date": the date of the document or the capture shown in it as YYYY-MM-DD, or null. Do not use today's date.
- "topics": 2-5 high-level themes.

ENTITIES
- Only specific real-world instances shown in the image: people, organizations, products, places, account numbers and references. Not field labels, menu items, button names or boilerplate.
- "raw_text" is the string as it appears; "canonical_name" is the same name with casing and spacing tidied. Copy proper nouns character by character from the image or the OCR text, not from memory.
- "type": person | organization | location | product | account | identifier | contact | other.
- Prefer under-extraction to over-extraction.

TAGS
- Short keywords for browsing, 1-3 words each, at most 30 characters, at most 8. Put the app or source first when there is one.
- Never account numbers, identifiers, dates, amounts or field labels.
`;

const KIND_HINTS: Record<LookKind, string> = {
    screenshot: 'screenshot',
    document: 'document (a page of paper)',
    receipt: 'receipt',
    diagram: 'diagram',
};

interface ImagePromptContext {
    filename: string;
    kind: LookKind;
    /** Null when OCR found nothing to store. */
    ocrResult: Pick<OcrResult, 'raw_text' | 'confidence_score'> | null;
}

function toOcrSection(ocrResult: ImagePromptContext['ocrResult']): string {
    const text = ocrResult?.raw_text?.trim() ?? '';

    if (text.length === 0) return 'OCR text: none was found. Read the image itself.';

    const confidence = ocrResult?.confidence_score ?? null;
    const unreliable = confidence !== null && confidence < env.LLM_MIN_OCR_CONFIDENCE;
    const note = confidence === null ? '' : ` (OCR confidence ${confidence}%${unreliable ? ': unreliable, trust the image over it' : ''})`;

    return `OCR text${note}:\n---\n${buildPromptWithSamplingContext(prepareTextForLlm(text))}\n---`;
}

/** The text part of the request; the image block is added next to it by the caller. */
export function buildImagePrompt({ filename, kind, ocrResult }: ImagePromptContext): LlmPrompt {
    const user = `Filename: "${filename}"
Kind hint from the local classifier: ${KIND_HINTS[kind]}

${toOcrSection(ocrResult)}

Analyze the image and fill in every field.`;

    return { system: SYSTEM_MESSAGE, user, maxTokens: env.LLM_MAX_OUTPUT_TOKENS };
}

/**
 * Text analysis pipeline (no database)
 *
 * OCR text -> prepared text -> prompt -> model -> entity grounding -> spelling
 * correction. Shared by the LLM service and the model-comparison harness so the
 * harness measures exactly what production runs.
 */

import type { Entity } from '@reverie/shared';
import type { Document, OcrResult } from '../db/schema';
import { groundEntities } from './entity-grounding';
import type { LlmAnalysis } from './llm-response.schema';
import { buildDocumentPrompt } from './prompt-builder';
import { getProvider } from './provider-config';
import type { LlmCallOptions, LlmCallUsage } from './provider';
import { buildSpellingCorrector, correctText } from './spelling-corrector';
import { prepareTextForLlm } from './text-preparer';
import type { PreparedText } from './types';

export interface TextAnalysis {
    /** The model's raw structured output, before grounding and correction. */
    result: LlmAnalysis;
    prepared: PreparedText;
    /** Entities whose names were checked against the OCR text. */
    entities: Entity[];
    /** Spelling-corrected free-text fields. */
    summary: string;
    title: string | null;
    topics: string[];
    tags: string[];
    /** Null when a local server reported no token counts. */
    tokenCount: number | null;
    call: LlmCallUsage;
    preparePromptMs: number;
    llmMs: number;
}

export async function analyzeOcrText(
    document: Pick<Document, 'original_filename'>,
    ocrResult: Pick<OcrResult, 'raw_text' | 'confidence_score'>,
    options: LlmCallOptions = {},
): Promise<TextAnalysis> {
    const prepareStart = Date.now();
    const prepared = prepareTextForLlm(ocrResult.raw_text);
    const prompt = buildDocumentPrompt({ document, ocrResult, preparedText: prepared });
    const preparePromptMs = Date.now() - prepareStart;

    const llmStart = Date.now();
    const { result, tokenCount, call } = await (await getProvider('summary')).summarize(prompt, options);
    const llmMs = Date.now() - llmStart;

    // Ground entity names against the OCR text: accept casing/whitespace tidy and
    // common OCR-confusion fixes, revert anything else (likely hallucination) to
    // the document's own spelling. See entity-grounding.ts.
    const entities = groundEntities(result.entities, ocrResult.raw_text);

    // Scrub the free-text fields (summary/title/topics/tags) for proper nouns the
    // model re-typed with a hallucinated spelling, using the grounded entities as
    // the source of the document's true spellings. See spelling-corrector.ts.
    const corrector = buildSpellingCorrector(entities, ocrResult.raw_text);

    return {
        result,
        prepared,
        entities,
        summary: correctText(result.summary, corrector),
        title: result.title ? correctText(result.title, corrector) : result.title,
        topics: result.topics.map((topic) => correctText(topic, corrector)),
        tags: result.tags.map((tag) => correctText(tag, corrector)),
        tokenCount,
        call,
        preparePromptMs,
        llmMs,
    };
}

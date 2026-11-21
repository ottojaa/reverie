/**
 * Screenshots and document images: one Claude call that sees the picture together with its OCR text (which may be
 * empty), then the same storage steps as the text summary. The caller has checked privacy, the trash and
 * decideImageLook; this module never runs for a photo.
 */
import type { Entity } from '@reverie/shared';
import { env } from '../config/env';
import { db } from '../db/kysely';
import type { Document, OcrResult } from '../db/schema';
import { enqueueTextEmbedding } from '../embeddings/enqueue';
import { KIND_TO_CATEGORY } from '../image-kind/kinds';
import { rebuildSearchVector } from '../search/search-indexer';
import { assertFitsInMemory, getStorageService } from '../services/storage.service';
import { buildSkipMetadata } from './eligibility';
import { isLlmAvailable } from './anthropic.client';
import { groundEntities } from './entity-grounding';
import { prepareImageForClaude, understandImage } from './image-call';
import type { LookKind } from './image-look';
import { buildImagePrompt } from './image-prompt';
import type { LlmEntity } from './llm-response.schema';
import { upsertLlmResult, updateSearchIndex } from './llm-store';
import { buildSpellingCorrector, correctText, type SpellingCorrector } from './spelling-corrector';
import type { DocumentLlmResult, EnhancedMetadata } from './types';

/** OCR text the model's output can be checked against: there is some, and it is not below the confidence floor. */
export function isReliableOcr(ocrResult: Pick<OcrResult, 'raw_text' | 'confidence_score'> | null | undefined): ocrResult is OcrResult {
    if (!ocrResult?.raw_text?.trim()) return false;

    return ocrResult.confidence_score === null || ocrResult.confidence_score >= env.LLM_MIN_OCR_CONFIDENCE;
}

/**
 * The category after the call. The model's kind may move an image among screenshot, document, receipt and diagram;
 * photo is in neither input nor output, so an image never moves to or from it. A document or receipt takes the model's
 * document type (invoice, letter, ...) when it names one, otherwise the kind's own category.
 */
export function toCategoryAfterLook(kind: LookKind, documentType: string | null): string {
    if (kind === 'screenshot') return KIND_TO_CATEGORY.screenshot;

    if (kind === 'diagram') return KIND_TO_CATEGORY.diagram;

    return documentType && documentType !== 'other' ? documentType : KIND_TO_CATEGORY[kind];
}

/** The app or source goes in as an entity and as the first tag, so it is searchable like any other. */
function addAppOrSource(app: string | null, entities: Entity[], tags: string[]): { entities: Entity[]; tags: string[] } {
    const name = app?.trim();

    if (!name) return { entities, tags };

    const known = entities.some((entity) => entity.canonical_name.toLowerCase() === name.toLowerCase());
    const entity: Entity = { type: 'product', raw_text: name, canonical_name: name };

    return {
        entities: known ? entities : [...entities, entity],
        tags: [name, ...tags.filter((tag) => tag.toLowerCase() !== name.toLowerCase())],
    };
}

/**
 * The model reads pixels, so entities are checked against the OCR text, and the free text is spell-corrected from it,
 * only when that text is reliable. Against missing or poor OCR the check would drop true entities.
 */
function checkAgainstOcr(entities: LlmEntity[], ocrResult: OcrResult | null | undefined): { entities: Entity[]; fix: (text: string) => string } {
    if (!isReliableOcr(ocrResult)) {
        return { entities: entities.map((e) => ({ type: e.type, raw_text: e.raw_text, canonical_name: e.canonical_name })), fix: (text) => text };
    }

    const grounded = groundEntities(entities, ocrResult.raw_text);
    const corrector: SpellingCorrector = buildSpellingCorrector(grounded, ocrResult.raw_text);

    return { entities: grounded, fix: (text) => correctText(text, corrector) };
}

async function recordSkip(document: Document, ocrResult: OcrResult | null | undefined): Promise<DocumentLlmResult> {
    await upsertLlmResult(document.id, {
        summary: null,
        metadata: buildSkipMetadata('llm_unavailable', ocrResult?.raw_text?.length),
        token_count: null,
        processing_type: 'image_understanding',
    });
    await db.updateTable('documents').set({ llm_status: 'skipped' }).where('id', '=', document.id).execute();

    return { success: true, skipped: true, reason: 'llm_unavailable' };
}

/** Runs the call for one image and stores the result: llm_results, category, date, tags, search text, embedding. */
export async function processImageUnderstanding(document: Document, ocrResult: OcrResult | null | undefined, look: LookKind): Promise<DocumentLlmResult> {
    // Without an API key nothing is written over an existing summary.
    if (!isLlmAvailable()) return recordSkip(document, ocrResult);

    assertFitsInMemory(document.size_bytes, 'describe');

    const image = await prepareImageForClaude(await getStorageService().getFile(document.file_path));
    const prompt = buildImagePrompt({ filename: document.original_filename, kind: look, ocrResult: ocrResult ?? null });
    const { result, tokenCount } = await understandImage(image, prompt);
    const { entities: checked, fix } = checkAgainstOcr(result.entities, ocrResult);
    const withApp = addAppOrSource(result.app_or_source, checked, result.tags.map(fix));
    const summary = fix(result.summary);
    const topics = result.topics.map(fix);
    const title = result.title ? fix(result.title) : null;

    const metadata: EnhancedMetadata = {
        type: 'image_understanding',
        title: title ?? undefined,
        language: result.language ?? undefined,
        entities: withApp.entities,
        topics,
        documentType: result.document_type ?? undefined,
        extractedDate: result.extracted_date ?? undefined,
        appOrSource: result.app_or_source?.trim() || undefined,
        imageKind: result.kind,
    };

    await upsertLlmResult(document.id, { summary, metadata, token_count: tokenCount, processing_type: 'image_understanding' });
    await db
        .updateTable('documents')
        .set({
            llm_status: 'complete',
            document_category: toCategoryAfterLook(result.kind, result.document_type),
            extracted_date: result.extracted_date ? new Date(`${result.extracted_date}T00:00:00Z`) : null,
        })
        .where('id', '=', document.id)
        .execute();
    await updateSearchIndex(document.id, { tags: withApp.tags, topics, entities: withApp.entities });
    await rebuildSearchVector(db, document.id);
    // The summary is part of the embedded text, so embed again now that it exists.
    await enqueueTextEmbedding(document.id);

    return { success: true, summary, enhancedMetadata: metadata, tokenCount };
}

/**
 * LLM Service
 *
 * Main orchestration for LLM document processing:
 * - Check eligibility and route to appropriate processor
 * - Handle text summarization with sampling
 * - Handle vision processing for images
 * - Store results and update search indexes
 */

import { Entity } from '@reverie/shared';
import { env } from '../config/env';
import { db } from '../db/kysely';
import type { Document, OcrResult } from '../db/schema';
import { rebuildSearchVector } from '../search/search-indexer';
import { getStorageService } from '../services/storage.service';
import { isVisualCategory } from '../ocr/category-classifier';
import { buildSkipMetadata, checkLlmEligibility } from './eligibility';
import { describeImage, isLlmAvailable, summarizeDocument } from './anthropic.client';
import { groundEntities } from './entity-grounding';
import { buildDocumentPrompt, getVisionPrompt } from './prompt-builder';
import { buildSpellingCorrector, correctText } from './spelling-corrector';
import { sanitizeTags } from './tag-sanitizer';
import { prepareTextForLlm } from './text-preparer';
import type { DocumentLlmResult, EnhancedMetadata, LlmProcessingType, VisionResult } from './types';

interface ProcessDocumentOptions {
    forceType?: LlmProcessingType | undefined;
    document?: Document | undefined;
    ocrResult?: OcrResult | null | undefined;
}

function shouldLogTimings(): boolean {
    return process.env.NODE_ENV !== 'production';
}

function logTimings(stage: string, documentId: string, durations: Record<string, number>): void {
    if (!shouldLogTimings()) return;

    console.info(`[LLMService] ${stage} timings`, JSON.stringify({ documentId, ...durations }));
}

/**
 * Process a document with LLM
 *
 * Main entry point for LLM processing. Checks eligibility, routes to
 * appropriate processor, and stores results.
 */
export async function processDocument(documentId: string, options: ProcessDocumentOptions = {}): Promise<DocumentLlmResult> {
    const totalStart = Date.now();
    const fetchStart = Date.now();
    // 1. Fetch document and OCR result
    const document = options.document ?? (await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst());

    if (!document) {
        throw new Error(`Document ${documentId} not found`);
    }

    const ocrResult = options.ocrResult ?? (await db.selectFrom('ocr_results').selectAll().where('document_id', '=', documentId).executeTakeFirst());
    const fetchMs = Date.now() - fetchStart;

    // 2. Check eligibility (unless type is explicitly provided)
    const eligibilityStart = Date.now();
    const eligibility = checkLlmEligibility(document, ocrResult);
    const processingType = options.forceType || eligibility.processingType;
    const eligibilityMs = Date.now() - eligibilityStart;

    if (!eligibility.eligible && !options.forceType) {
        const saveStart = Date.now();
        // Store skip reason in llm_results
        await upsertLlmResult(documentId, {
            summary: null,
            metadata: buildSkipMetadata(eligibility.reason!, ocrResult?.raw_text?.length, eligibility.warnings),
            token_count: null,
            processing_type: 'text_summary',
        });

        await db.updateTable('documents').set({ llm_status: 'complete' }).where('id', '=', documentId).execute();
        const saveMs = Date.now() - saveStart;
        logTimings('skip_path', documentId, {
            fetchMs,
            eligibilityMs,
            saveMs,
            totalMs: Date.now() - totalStart,
        });

        return {
            success: true,
            skipped: true,
            reason: eligibility.reason,
        };
    }

    // 3. Route to appropriate processor
    if (processingType === 'vision_describe') {
        return processVisionDocument(document, {
            fetchMs,
            eligibilityMs,
            totalStart,
        });
    }

    // Text summary flow (default)
    return processTextSummary(document, ocrResult!, {
        fetchMs,
        eligibilityMs,
        totalStart,
    });
}

/**
 * Process a document for text summarization
 */
async function processTextSummary(
    document: Document,
    ocrResult: OcrResult,
    baseTimings: { fetchMs: number; eligibilityMs: number; totalStart: number },
): Promise<DocumentLlmResult> {
    // No API key → no summary. Record an explicit skip (never a pseudo-summary
    // built from OCR scraps) so the document stays honest and retryable.
    if (!isLlmAvailable()) {
        const saveStart = Date.now();

        await upsertLlmResult(document.id, {
            summary: null,
            metadata: buildSkipMetadata('llm_unavailable', ocrResult.raw_text?.length),
            token_count: null,
            processing_type: 'text_summary',
        });

        await db.updateTable('documents').set({ llm_status: 'skipped' }).where('id', '=', document.id).execute();
        const saveMs = Date.now() - saveStart;
        logTimings('text_summary_unavailable', document.id, {
            ...baseTimings,
            saveMs,
            totalMs: Date.now() - baseTimings.totalStart,
        });

        return {
            success: true,
            skipped: true,
            reason: 'llm_unavailable',
        };
    }

    // Prepare text with sampling if needed
    const prepareStart = Date.now();
    const prepared = prepareTextForLlm(ocrResult.raw_text);

    // Build prompt
    const prompt = buildDocumentPrompt({
        document,
        ocrResult,
        preparedText: prepared,
    });
    const preparePromptMs = Date.now() - prepareStart;

    // Call the LLM
    const llmStart = Date.now();
    const { result, tokenCount } = await summarizeDocument(prompt);
    const llmMs = Date.now() - llmStart;

    // Ground entity names against the OCR text: accept casing/whitespace tidy and
    // common OCR-confusion fixes, revert anything else (likely hallucination) to
    // the document's own spelling. See entity-grounding.ts.
    const groundedEntities = groundEntities(result.entities, ocrResult.raw_text);

    // Scrub the free-text fields (summary/title/topics/tags) for proper nouns the
    // model re-typed with a hallucinated spelling, using the grounded entities as
    // the source of the document's true spellings. See spelling-corrector.ts.
    const corrector = buildSpellingCorrector(groundedEntities, ocrResult.raw_text);
    const summary = correctText(result.summary, corrector);
    const title = result.title ? correctText(result.title, corrector) : result.title;
    const topics = result.topics.map((topic) => correctText(topic, corrector));
    const proposedTags = result.tags.map((tag) => correctText(tag, corrector));

    // Build enhanced metadata
    const enhancedMetadata: EnhancedMetadata = {
        type: 'text_summary',
        title: title ?? undefined,
        language: result.language ?? undefined,
        entities: groundedEntities,
        topics,
        documentType: result.document_type ?? undefined,
        extractedDate: result.extracted_date ?? undefined,
        // Sampling info
        truncated: prepared.truncated,
        samplingStrategy: prepared.samplingStrategy,
        originalTextLength: prepared.originalLength,
        sampledSections: prepared.sampledSections,
    };

    // Parse primary extracted date into a Date for the DB column
    const extractedDate = result.extracted_date ? new Date(`${result.extracted_date}T00:00:00Z`) : null;

    // Update document with LLM-determined category if available, but never overwrite a
    // visual category (screenshot/photo/graphic/video) set during OCR — the text LLM only
    // sees OCR text, not pixels, and its type enum has no visual categories.
    const documentCategory = isVisualCategory(document.document_category) ? document.document_category : (result.document_type ?? document.document_category);

    const dbWriteStart = Date.now();

    await upsertLlmResult(document.id, {
        summary,
        metadata: enhancedMetadata,
        token_count: tokenCount,
        processing_type: 'text_summary',
    });

    await db
        .updateTable('documents')
        .set({
            llm_status: 'complete',
            document_category: documentCategory,
            extracted_date: extractedDate,
        })
        .where('id', '=', document.id)
        .execute();

    // Update search index with enhanced data (spelling-corrected tags/topics)
    await updateSearchIndex(document.id, { tags: proposedTags, topics, entities: groundedEntities });

    await rebuildSearchVector(db, document.id);

    const dbWriteMs = Date.now() - dbWriteStart;
    logTimings('text_summary', document.id, {
        ...baseTimings,
        preparePromptMs,
        llmMs,
        dbWriteMs,
        tokenCount,
        totalMs: Date.now() - baseTimings.totalStart,
    });

    return {
        success: true,
        summary,
        enhancedMetadata,
        tokenCount,
        truncated: prepared.truncated,
        samplingStrategy: prepared.samplingStrategy,
        originalTextLength: prepared.originalLength,
    };
}

/**
 * Process an image document with vision API
 */
async function processVisionDocument(document: Document, baseTimings: { fetchMs: number; eligibilityMs: number; totalStart: number }): Promise<VisionResult> {
    if (!env.LLM_VISION_ENABLED) {
        return {
            success: true,
            skipped: true,
            reason: 'vision_disabled',
        };
    }

    // Load image from storage
    const storageStart = Date.now();
    const storageService = getStorageService();
    const imageBuffer = await storageService.getFile(document.file_path);
    const storageLoadMs = Date.now() - storageStart;
    const encodeStart = Date.now();
    const base64Image = imageBuffer.toString('base64');
    const encodeMs = Date.now() - encodeStart;

    // Call vision API
    const llmStart = Date.now();
    const { result, tokenCount } = await describeImage(base64Image, document.mime_type, getVisionPrompt());
    const llmMs = Date.now() - llmStart;

    // Build enhanced metadata
    const enhancedMetadata: EnhancedMetadata = {
        type: 'vision_describe',
        entities: [],
        topics: [],
        detectedObjects: result.detected_objects,
        sceneType: result.scene_type,
        hasPeople: result.has_people,
    };

    // Store LLM result
    const dbWriteStart = Date.now();
    await upsertLlmResult(document.id, {
        summary: result.description,
        metadata: enhancedMetadata,
        token_count: tokenCount,
        processing_type: 'vision_describe',
    });

    await db.updateTable('documents').set({ llm_status: 'complete' }).where('id', '=', document.id).execute();

    // Index detected objects as tag candidates (topics fallback path in the sanitizer).
    await updateSearchIndex(document.id, { tags: [], topics: result.detected_objects ?? [], entities: [] });

    await rebuildSearchVector(db, document.id);

    const dbWriteMs = Date.now() - dbWriteStart;
    logTimings('vision_describe', document.id, {
        ...baseTimings,
        storageLoadMs,
        encodeMs,
        llmMs,
        dbWriteMs,
        tokenCount,
        totalMs: Date.now() - baseTimings.totalStart,
    });

    return {
        success: true,
        description: result.description,
        metadata: enhancedMetadata,
        tokenCount,
    };
}

/**
 * Upsert an LLM result for a document
 */
async function upsertLlmResult(
    documentId: string,
    data: { summary: string | null; metadata: unknown; token_count: number | null; processing_type: string },
): Promise<void> {
    await db
        .insertInto('llm_results')
        .values({
            document_id: documentId,
            summary: data.summary,
            metadata: data.metadata as any,
            token_count: data.token_count,
            processing_type: data.processing_type,
        })
        .onConflict((oc) =>
            oc.column('document_id').doUpdateSet({
                summary: data.summary,
                metadata: data.metadata as any,
                token_count: data.token_count,
                processing_type: data.processing_type,
            }),
        )
        .execute();
}

/**
 * Replace the document's auto-generated tags with a freshly sanitized set.
 *
 * This is the only writer of document_tags. Deleting existing source='auto' tags
 * before inserting new ones fixes tag accumulation across reprocesses; user tags
 * (source='user') are preserved and used as dedup targets. Tag candidates are the
 * LLM's proposed tags, with topics/entity names as fallbacks (see sanitizeTags).
 */
async function updateSearchIndex(documentId: string, analysis: { tags: string[]; topics: string[]; entities: Entity[] }): Promise<void> {
    await db.transaction().execute(async (trx) => {
        const userTags = await trx.selectFrom('document_tags').select('tag').where('document_id', '=', documentId).where('source', '=', 'user').execute();

        const tags = sanitizeTags({
            proposedTags: analysis.tags,
            topics: analysis.topics,
            entities: analysis.entities,
            existingTags: userTags.map((t) => t.tag),
        });

        await trx.deleteFrom('document_tags').where('document_id', '=', documentId).where('source', '=', 'auto').execute();

        if (tags.length === 0) {
            return;
        }

        await trx
            .insertInto('document_tags')
            .values(tags.map((tag) => ({ document_id: documentId, tag, source: 'auto' as const })))
            .onConflict((oc) => oc.columns(['document_id', 'tag']).doNothing())
            .execute();
    });
}

/**
 * Reprocess a document with LLM (force regeneration)
 */
export async function reprocessDocument(documentId: string): Promise<DocumentLlmResult> {
    // Clear existing LLM result
    await db.deleteFrom('llm_results').where('document_id', '=', documentId).execute();

    return processDocument(documentId);
}

/**
 * Batch process multiple documents
 */
export async function batchProcessDocuments(documentIds: string[]): Promise<Map<string, DocumentLlmResult>> {
    const results = new Map<string, DocumentLlmResult>();

    // Process sequentially to avoid rate limiting
    for (const documentId of documentIds) {
        try {
            const result = await processDocument(documentId);
            results.set(documentId, result);
        } catch (_error) {
            results.set(documentId, {
                success: false,
                reason: 'llm_disabled',
            });
        }
    }

    return results;
}

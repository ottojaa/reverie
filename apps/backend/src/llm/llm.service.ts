/**
 * LLM Service
 *
 * Main orchestration for LLM document processing:
 * - Check eligibility and route to appropriate processor
 * - Handle text summarization with sampling
 * - Handle screenshots and document images with the one call that sees the image and its OCR text
 * - Store results and update search indexes
 */

import { db } from '../db/kysely';
import type { Document, OcrResult } from '../db/schema';
import { enqueueTextEmbedding } from '../embeddings/enqueue';
import { rebuildSearchVector } from '../search/search-indexer';
import { isDocumentPrivate } from '../services/privacy';
import { isVisualCategory } from '../ocr/category-classifier';
import { buildSkipMetadata, checkLlmEligibility } from './eligibility';
import { processImageUnderstanding } from './image-understanding';
import { decideImageLook } from './image-look';
import { updateSearchIndex, upsertLlmResult } from './llm-store';
import { isCapabilityAvailable, isVisionAvailable, isVisionSwitchedOn } from './provider-config';
import { analyzeOcrText } from './text-analysis';
import type { DocumentLlmResult, EnhancedMetadata, StoredLlmProcessingType } from './types';

interface ProcessDocumentOptions {
    forceType?: StoredLlmProcessingType | undefined;
    document?: Document | undefined;
    ocrResult?: OcrResult | null | undefined;
    /** Effective privacy when the caller already looked it up; otherwise it is looked up here. */
    isPrivate?: boolean | undefined;
}

function shouldLogTimings(): boolean {
    return process.env.NODE_ENV !== 'production';
}

function logTimings(stage: string, documentId: string, durations: Record<string, number | null>): void {
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

    // 2. Privacy is a hard stop, ahead of any forced type: a locked item never reaches the LLM.
    // No llm_results row is written, so the document can still be processed after it is unlocked.
    const isPrivate = options.isPrivate ?? (await isDocumentPrivate(document));

    if (isPrivate) {
        await db.updateTable('documents').set({ llm_status: 'skipped' }).where('id', '=', documentId).execute();

        return { success: true, skipped: true, reason: 'private' };
    }

    // Same hard stop for the trash: no Anthropic call and no llm_results row for a trashed document.
    if (document.deleted_at) {
        await db.updateTable('documents').set({ llm_status: 'skipped' }).where('id', '=', documentId).execute();

        return { success: true, skipped: true, reason: 'trashed' };
    }

    // 3. Check eligibility (unless type is explicitly provided)
    const eligibilityStart = Date.now();
    const eligibility = checkLlmEligibility(document, ocrResult, { isPrivate, vision: await isVisionSwitchedOn() });
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

    // 4. Route to appropriate processor
    const timings = { fetchMs, eligibilityMs, totalStart };

    if (processingType === 'image_understanding' || processingType === 'vision_describe') {
        // Decided now, not when the job was queued: a photo's pixels never reach Claude, whatever type the job carries,
        // and neither do any pixels once vision is switched off (a job queued while it was on may still be waiting).
        const look = (await isVisionAvailable()) ? await decideImageLook(document) : { call: false as const, heldBack: false };

        if (look.call) return processImageUnderstanding(document, ocrResult, look.kind);

        return processImageWithoutCall(document, ocrResult, { heldBack: look.heldBack, isPrivate, timings });
    }

    // Text summary flow (default)
    return processTextSummary(document, ocrResult!, timings);
}

/**
 * An image that does not get the image call. If it has OCR text it still gets the text summary (a photo of a sign is
 * summarised from its text, never its pixels). Otherwise a photo is skipped without a stored result, so the job can
 * run again if the classifier later says otherwise, and any other image gets a stored "nothing to summarise" skip.
 */
async function processImageWithoutCall(
    document: Document,
    ocrResult: OcrResult | null | undefined,
    { heldBack, isPrivate, timings }: { heldBack: boolean; isPrivate: boolean; timings: { fetchMs: number; eligibilityMs: number; totalStart: number } },
): Promise<DocumentLlmResult> {
    const textEligibility = checkLlmEligibility(document, ocrResult, { isPrivate, vision: false });

    if (textEligibility.eligible && ocrResult) return processTextSummary(document, ocrResult, timings);

    if (heldBack) {
        await db.updateTable('documents').set({ llm_status: 'skipped' }).where('id', '=', document.id).execute();

        return { success: true, skipped: true, reason: 'photo' };
    }

    await upsertLlmResult(document.id, {
        summary: null,
        metadata: buildSkipMetadata(textEligibility.reason ?? 'no_text_content', ocrResult?.raw_text?.length, textEligibility.warnings),
        token_count: null,
        processing_type: 'text_summary',
    });
    await db.updateTable('documents').set({ llm_status: 'complete' }).where('id', '=', document.id).execute();

    return { success: true, skipped: true, reason: textEligibility.reason };
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
    if (!(await isCapabilityAvailable('summary'))) {
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

    const {
        result,
        prepared,
        entities: groundedEntities,
        summary,
        title,
        topics,
        tags: proposedTags,
        tokenCount,
        preparePromptMs,
        llmMs,
    } = await analyzeOcrText(document, ocrResult);

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
    // The summary is part of the embedded text, so embed again now that it exists.
    await enqueueTextEmbedding(document.id);

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
        tokenCount: tokenCount ?? undefined,
        truncated: prepared.truncated,
        samplingStrategy: prepared.samplingStrategy,
        originalTextLength: prepared.originalLength,
    };
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

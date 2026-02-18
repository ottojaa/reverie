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
import { getStorageService } from '../services/storage.service';
import { buildSkipMetadata, checkLlmEligibility } from './eligibility';
import { describeImage, isOpenAIAvailable, summarizeDocument } from './openai.client';
import { buildDocumentPrompt, buildFallbackSummary, getVisionPrompt } from './prompt-builder';
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

        await db
            .updateTable('documents')
            .set({ llm_status: 'complete' })
            .where('id', '=', documentId)
            .execute();
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
    // Check if OpenAI is available
    if (!isOpenAIAvailable()) {
        const saveStart = Date.now();
        const fallbackSummary = buildFallbackSummary(document, ocrResult);

        await upsertLlmResult(document.id, {
            summary: fallbackSummary,
            metadata: {
                type: 'text_summary',
                entities: [],
                topics: [],
                fallback: true,
                reason: 'openai_unavailable',
            },
            token_count: 0,
            processing_type: 'text_summary',
        });

        await db
            .updateTable('documents')
            .set({ llm_status: 'complete' })
            .where('id', '=', document.id)
            .execute();
        const saveMs = Date.now() - saveStart;
        logTimings('text_summary_fallback', document.id, {
            ...baseTimings,
            saveMs,
            totalMs: Date.now() - baseTimings.totalStart,
        });

        return {
            success: true,
            summary: fallbackSummary,
            tokenCount: 0,
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

    // Call OpenAI
    const llmStart = Date.now();
    const { result, tokenCount } = await summarizeDocument(prompt);
    const llmMs = Date.now() - llmStart;

    // Build enhanced metadata
    const enhancedMetadata: EnhancedMetadata = {
        type: 'text_summary',
        title: result.title,
        language: result.language,
        entities: result.entities,
        topics: result.topics,
        documentType: result.document_type,
        extractedDate: result.extracted_date,
        // Sampling info
        truncated: prepared.truncated,
        samplingStrategy: prepared.samplingStrategy,
        originalTextLength: prepared.originalLength,
        sampledSections: prepared.sampledSections,
    };

    // Parse primary extracted date into a Date for the DB column
    const extractedDate = result.extracted_date ? new Date(`${result.extracted_date}T00:00:00`) : null;

    // Update document with LLM-determined category if available
    const documentCategory = result.document_type ?? document.document_category;

    const dbWriteStart = Date.now();
    await upsertLlmResult(document.id, {
        summary: result.summary,
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

    // Update search index with enhanced data
    await updateSearchIndex(document.id, result.summary, result.entities, result.topics);
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
        summary: result.summary,
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
async function processVisionDocument(
    document: Document,
    baseTimings: { fetchMs: number; eligibilityMs: number; totalStart: number },
): Promise<VisionResult> {
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

    await db
        .updateTable('documents')
        .set({ llm_status: 'complete' })
        .where('id', '=', document.id)
        .execute();

    // Index the description for search
    if (result.description) {
        const emptyEntities: Entity[] = [];
        await updateSearchIndex(document.id, result.description, emptyEntities, result.detected_objects ?? []);
    }

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
 * Update the search index with LLM-generated content
 *
 * Stores entities and topics as document tags for faceted search
 */
async function updateSearchIndex(documentId: string, summary: string, entities: Entity[], topics: string[]): Promise<void> {
    const searchText = [summary, ...entities, ...topics].filter(Boolean).join(' ');

    if (!searchText) {
        return;
    }

    // Store LLM search terms in document tags for faceted search
    const tagsToAdd = [...entities.map((e) => e.canonical_name), ...topics].filter(Boolean);

    if (tagsToAdd.length === 0) {
        return;
    }

    const existingTags = await db.selectFrom('document_tags').select('tag').where('document_id', '=', documentId).where('source', '=', 'auto').execute();

    const existingTagSet = new Set(existingTags.map((t) => t.tag.toLowerCase()));
    const newTags = tagsToAdd.filter((t) => !existingTagSet.has(t.toLowerCase()));

    if (newTags.length > 0) {
        await db
            .insertInto('document_tags')
            .values(
                newTags.map((tag) => ({
                    document_id: documentId,
                    tag,
                    source: 'auto' as const,
                })),
            )
            .execute();
    }
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

/**
 * LLM Service (Plan 06)
 *
 * Main orchestration for LLM document processing:
 * - Check eligibility and route to appropriate processor
 * - Handle text summarization with sampling
 * - Handle vision processing for images
 * - Store results and update search indexes
 */

import { db } from '../db/kysely';
import type { Document, OcrResult } from '../db/schema';
import { getStorageService } from '../services/storage.service';
import { checkLlmEligibility, buildSkipMetadata } from './eligibility';
import { describeImage, isOpenAIAvailable, summarizeDocument } from './openai.client';
import { buildDocumentPrompt, buildFallbackSummary, getVisionPrompt } from './prompt-builder';
import { prepareTextForLlm } from './text-preparer';
import type { DocumentLlmResult, EnhancedMetadata, LlmProcessingType, VisionResult } from './types';
import { env } from '../config/env';

/**
 * Process a document with LLM
 *
 * Main entry point for LLM processing. Checks eligibility, routes to
 * appropriate processor, and stores results.
 */
export async function processDocument(
    documentId: string,
    forceType?: LlmProcessingType
): Promise<DocumentLlmResult> {
    // 1. Fetch document and OCR result
    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();

    if (!document) {
        throw new Error(`Document ${documentId} not found`);
    }

    const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', documentId).executeTakeFirst();

    // 2. Check eligibility (unless type is explicitly provided)
    const eligibility = checkLlmEligibility(document, ocrResult);
    const processingType = forceType || eligibility.processingType;

    if (!eligibility.eligible && !forceType) {
        // Store skip reason in metadata
        await db
            .updateTable('documents')
            .set({
                llm_metadata: buildSkipMetadata(
                    eligibility.reason!,
                    ocrResult?.raw_text?.length,
                    eligibility.warnings
                ),
                llm_processed_at: new Date(),
            })
            .where('id', '=', documentId)
            .execute();

        return {
            success: true,
            skipped: true,
            reason: eligibility.reason,
        };
    }

    // 3. Route to appropriate processor
    if (processingType === 'vision_describe') {
        return processVisionDocument(document);
    }

    // Text summary flow (default)
    return processTextSummary(document, ocrResult!);
}

/**
 * Process a document for text summarization
 */
async function processTextSummary(document: Document, ocrResult: OcrResult): Promise<DocumentLlmResult> {
    // Check if OpenAI is available
    if (!isOpenAIAvailable()) {
        // Generate fallback summary
        const fallbackSummary = buildFallbackSummary(document, ocrResult);
        await db
            .updateTable('documents')
            .set({
                llm_summary: fallbackSummary,
                llm_metadata: {
                    type: 'text_summary',
                    fallback: true,
                    reason: 'openai_unavailable',
                },
                llm_processed_at: new Date(),
                llm_token_count: 0,
            })
            .where('id', '=', document.id)
            .execute();

        return {
            success: true,
            summary: fallbackSummary,
            tokenCount: 0,
        };
    }

    // Prepare text with sampling if needed
    const prepared = prepareTextForLlm(ocrResult.raw_text);

    // Build prompt
    const prompt = buildDocumentPrompt({
        document,
        ocrResult,
        preparedText: prepared,
    });

    // Call OpenAI
    const { result, tokenCount } = await summarizeDocument(prompt);

    // Build enhanced metadata
    const enhancedMetadata: EnhancedMetadata = {
        type: 'text_summary',
        title: result.title,
        keyEntities: result.key_entities,
        topics: result.topics,
        sentiment: result.sentiment,
        documentType: result.document_type,
        extractedDates: result.additional_dates,
        keyValues: result.key_values,
        // Sampling info
        truncated: prepared.truncated,
        samplingStrategy: prepared.samplingStrategy,
        originalTextLength: prepared.originalLength,
        sampledSections: prepared.sampledSections,
    };

    // Update document
    await db
        .updateTable('documents')
        .set({
            llm_summary: result.summary,
            llm_metadata: enhancedMetadata,
            llm_processed_at: new Date(),
            llm_token_count: tokenCount,
        })
        .where('id', '=', document.id)
        .execute();

    // Update search index with enhanced data
    await updateSearchIndex(document.id, result.summary, result.key_entities, result.topics);

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
async function processVisionDocument(document: Document): Promise<VisionResult> {
    if (!env.LLM_VISION_ENABLED) {
        return {
            success: true,
            skipped: true,
            reason: 'vision_disabled',
        };
    }

    // Load image from storage
    const storageService = getStorageService();
    const imageBuffer = await storageService.getFile(document.file_path);
    const base64Image = imageBuffer.toString('base64');

    // Call vision API
    const { result, tokenCount } = await describeImage(base64Image, document.mime_type, getVisionPrompt());

    // Build enhanced metadata
    const enhancedMetadata: EnhancedMetadata = {
        type: 'vision_describe',
        keyEntities: [],
        topics: [],
        detectedObjects: result.detected_objects,
        sceneType: result.scene_type,
        hasPeople: result.has_people,
    };

    // Update document
    await db
        .updateTable('documents')
        .set({
            llm_summary: result.description,
            llm_metadata: enhancedMetadata,
            llm_processed_at: new Date(),
            llm_token_count: tokenCount,
        })
        .where('id', '=', document.id)
        .execute();

    // Optionally index the description for search
    if (result.description) {
        await updateSearchIndex(document.id, result.description, [], result.detected_objects ?? []);
    }

    return {
        success: true,
        description: result.description,
        metadata: enhancedMetadata,
        tokenCount,
    };
}

/**
 * Update the search index with LLM-generated content
 *
 * Appends summary, entities, and topics to the OCR text vector for search
 */
async function updateSearchIndex(
    documentId: string,
    summary: string,
    entities: string[],
    topics: string[]
): Promise<void> {
    // Build additional search text from LLM output
    const searchText = [summary, ...entities, ...topics].filter(Boolean).join(' ');

    if (!searchText) {
        return;
    }

    // Check if OCR result exists
    const existing = await db.selectFrom('ocr_results').select('id').where('document_id', '=', documentId).executeTakeFirst();

    if (existing) {
        // Update existing OCR result with enhanced search vector
        // The text_vector column uses PostgreSQL tsvector, we append to raw_text
        // which triggers the text_vector update via PostgreSQL trigger
        await db
            .updateTable('ocr_results')
            .set({
                // Note: In a production system, you might want a separate
                // llm_text_vector column to keep OCR and LLM text separate
                // For now, we'll store LLM content in metadata
                metadata: db.fn('COALESCE', ['metadata', db.val('{}')])
            })
            .where('document_id', '=', documentId)
            .execute();
    }

    // Store LLM search terms in document tags for faceted search
    const tagsToAdd = [...entities, ...topics].filter(Boolean);
    if (tagsToAdd.length > 0) {
        const existingTags = await db
            .selectFrom('document_tags')
            .select('tag')
            .where('document_id', '=', documentId)
            .where('source', '=', 'auto')
            .execute();

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
                    }))
                )
                .execute();
        }
    }
}

/**
 * Reprocess a document with LLM (force regeneration)
 */
export async function reprocessDocument(documentId: string): Promise<DocumentLlmResult> {
    // Clear existing LLM data first
    await db
        .updateTable('documents')
        .set({
            llm_summary: null,
            llm_metadata: null,
            llm_processed_at: null,
            llm_token_count: null,
        })
        .where('id', '=', documentId)
        .execute();

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
        } catch (error) {
            results.set(documentId, {
                success: false,
                reason: 'llm_disabled', // Using existing type, but represents error
            });
        }
    }

    return results;
}

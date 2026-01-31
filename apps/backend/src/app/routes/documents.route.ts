import { DocumentListQuerySchema, DocumentSchema, PaginatedResponseSchema, UuidSchema, type Document, type DocumentListQuery } from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db/kysely';
import { type Document as DbDocument } from '../../db/schema';
import { checkLlmEligibility } from '../../llm/eligibility';
import { addLlmJob } from '../../queues/llm.queue';
import { addOcrJob } from '../../queues/ocr.queue';
import { getStorageService } from '../../services/storage.service';
import { getUploadService } from '../../services/upload.service';

const uploadService = getUploadService();
const storageService = getStorageService();

// OCR Result schema for API responses
const OcrResultSchema = z.object({
    document_id: z.string().uuid(),
    raw_text: z.string(),
    confidence_score: z.number().nullable(),
    text_density: z.number().nullable(),
    has_meaningful_text: z.boolean(),
    metadata: z
        .object({
            companies: z.array(z.string()).optional(),
            dates: z.array(z.string()).optional(),
            values: z
                .array(
                    z.object({
                        amount: z.number(),
                        currency: z.string(),
                    }),
                )
                .optional(),
        })
        .nullable(),
    processed_at: z.string(),
});

export default async function (fastify: FastifyInstance) {
    // List documents (requires authentication)
    fastify.get<{
        Querystring: DocumentListQuery;
    }>(
        '/documents',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'List documents with optional filters',
                querystring: DocumentListQuerySchema,
                response: {
                    200: PaginatedResponseSchema(DocumentSchema),
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const { limit, offset, folder_id, category, date_from, date_to } = request.query;

            let query = db.selectFrom('documents').selectAll().where('user_id', '=', userId);

            // Apply filters
            if (folder_id) {
                query = query.where('folder_id', '=', folder_id);
            }
            if (category) {
                query = query.where('document_category', '=', category);
            }
            if (date_from) {
                query = query.where('extracted_date', '>=', new Date(date_from));
            }
            if (date_to) {
                query = query.where('extracted_date', '<=', new Date(date_to));
            }

            // Get total count (must apply same filters)
            let countQuery = db.selectFrom('documents').select(db.fn.countAll().as('count')).where('user_id', '=', userId);

            if (folder_id) {
                countQuery = countQuery.where('folder_id', '=', folder_id);
            }
            if (category) {
                countQuery = countQuery.where('document_category', '=', category);
            }
            if (date_from) {
                countQuery = countQuery.where('extracted_date', '>=', new Date(date_from));
            }
            if (date_to) {
                countQuery = countQuery.where('extracted_date', '<=', new Date(date_to));
            }

            const [documents, countResult] = await Promise.all([
                query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
                countQuery.executeTakeFirst(),
            ]);

            return {
                items: documents.map(serializeDocument),
                total: Number(countResult?.count ?? 0),
                limit,
                offset,
            };
        },
    );

    // Get document by ID (requires authentication)
    fastify.get<{
        Params: { id: string };
        Reply: Document;
    }>(
        '/documents/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get document by ID',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: DocumentSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }
            return serializeDocument(document);
        },
    );

    // Delete document (requires authentication)
    fastify.delete<{
        Params: { id: string };
    }>(
        '/documents/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Delete a document',
                params: z.object({ id: UuidSchema }),
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            // Delete file from storage (with storage usage update)
            try {
                await storageService.deleteFile(document.file_path, userId);

                // Delete thumbnails if they exist
                if (document.thumbnail_paths) {
                    for (const path of Object.values(document.thumbnail_paths)) {
                        await storageService.deleteFile(path, userId);
                    }
                }
            } catch (err) {
                // Log but don't fail if storage delete fails
                console.error('Failed to delete file from storage:', err);
            }

            // Delete from database (cascade will handle related records)
            await db.deleteFrom('documents').where('id', '=', request.params.id).where('user_id', '=', userId).execute();

            reply.status(204).send();
        },
    );

    // Get document status (requires authentication)
    fastify.get<{
        Params: { id: string };
    }>(
        '/documents/:id/status',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get document processing status',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: z.object({
                        document_id: z.string().uuid(),
                        ocr_status: z.enum(['pending', 'processing', 'complete', 'failed']),
                        thumbnail_status: z.enum(['pending', 'processing', 'complete', 'failed']),
                        jobs: z.array(
                            z.object({
                                type: z.string(),
                                status: z.enum(['pending', 'processing', 'complete', 'failed']),
                                completed_at: z.string().nullable(),
                            }),
                        ),
                    }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            // Get related jobs
            const jobs = await db
                .selectFrom('processing_jobs')
                .select(['id', 'job_type', 'status', 'completed_at'])
                .where('target_id', '=', request.params.id)
                .where('target_type', '=', 'document')
                .execute();

            return {
                document_id: document.id,
                ocr_status: document.ocr_status,
                thumbnail_status: document.thumbnail_status,
                jobs: jobs.map((job) => ({
                    type: job.job_type,
                    status: job.status,
                    completed_at: job.completed_at?.toISOString(),
                })),
            };
        },
    );

    // Get all jobs for a document (requires authentication)
    fastify.get<{
        Params: { id: string };
    }>(
        '/documents/:id/jobs',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get all processing jobs for a document',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: z.array(
                        z.object({
                            id: z.string().uuid(),
                            job_type: z.string(),
                            target_type: z.string(),
                            target_id: z.string().uuid(),
                            status: z.enum(['pending', 'processing', 'complete', 'failed']),
                            priority: z.number(),
                            attempts: z.number(),
                            error_message: z.string().nullable(),
                            result: z.unknown().nullable(),
                            created_at: z.string(),
                            started_at: z.string().nullable(),
                            completed_at: z.string().nullable(),
                        }),
                    ),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            const jobs = await db
                .selectFrom('processing_jobs')
                .selectAll()
                .where('target_id', '=', request.params.id)
                .where('target_type', '=', 'document')
                .orderBy('created_at', 'desc')
                .execute();

            return jobs.map((job) => ({
                id: job.id,
                job_type: job.job_type,
                target_type: job.target_type,
                target_id: job.target_id,
                status: job.status,
                priority: job.priority,
                attempts: job.attempts,
                error_message: job.error_message,
                result: job.result,
                created_at: job.created_at.toISOString(),
                started_at: job.started_at?.toISOString() ?? null,
                completed_at: job.completed_at?.toISOString() ?? null,
            }));
        },
    );

    // ==================== OCR Endpoints ====================

    // Trigger OCR processing for a document
    fastify.post<{
        Params: { id: string };
    }>(
        '/documents/:id/ocr',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Trigger OCR processing for a document',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: z.object({
                        job_id: z.string(),
                        status: z.enum(['pending', 'processing', 'already_complete']),
                    }),
                    404: z.object({ message: z.string() }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            // Check if already processing or complete
            if (document.ocr_status === 'complete') {
                return { job_id: '', status: 'already_complete' as const };
            }

            if (document.ocr_status === 'processing') {
                // Find existing job
                const existingJob = await db
                    .selectFrom('processing_jobs')
                    .select('id')
                    .where('target_id', '=', request.params.id)
                    .where('job_type', '=', 'ocr')
                    .where('status', 'in', ['pending', 'processing'])
                    .executeTakeFirst();

                return {
                    job_id: existingJob?.id ?? '',
                    status: 'processing' as const,
                };
            }

            // Queue new OCR job
            const jobId = `ocr-${request.params.id}-${nanoid(6)}`;
            await addOcrJob(
                {
                    documentId: request.params.id,
                    filePath: document.file_path,
                },
                jobId,
            );

            // Track in processing_jobs table
            await db
                .insertInto('processing_jobs')
                .values({
                    job_type: 'ocr',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .execute();

            // Update document status
            await db.updateTable('documents').set({ ocr_status: 'pending' }).where('id', '=', request.params.id).execute();

            return { job_id: jobId, status: 'pending' as const };
        },
    );

    // Get OCR result for a document
    fastify.get<{
        Params: { id: string };
    }>(
        '/documents/:id/ocr',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get OCR result for a document',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: OcrResultSchema,
                    404: z.object({ message: z.string() }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

            if (!ocrResult) {
                return reply.notFound('OCR result not found. Document may not have been processed yet.');
            }

            return {
                document_id: ocrResult.document_id,
                raw_text: ocrResult.raw_text,
                confidence_score: ocrResult.confidence_score,
                text_density: ocrResult.text_density ?? null,
                has_meaningful_text: (ocrResult as { has_meaningful_text?: boolean }).has_meaningful_text ?? true,
                metadata: ocrResult.metadata,
                processed_at: ocrResult.processed_at.toISOString(),
            };
        },
    );

    // Retry/reprocess OCR for a document
    fastify.post<{
        Params: { id: string };
    }>(
        '/documents/:id/ocr/retry',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Retry OCR processing for a document (force reprocess)',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: z.object({
                        job_id: z.string(),
                        status: z.literal('pending'),
                    }),
                    404: z.object({ message: z.string() }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            // Queue new OCR job with force reprocess flag
            const jobId = `ocr-retry-${request.params.id}-${nanoid(6)}`;
            await addOcrJob(
                {
                    documentId: request.params.id,
                    filePath: document.file_path,
                    forceReprocess: true,
                },
                jobId,
            );

            // Track in processing_jobs table
            await db
                .insertInto('processing_jobs')
                .values({
                    job_type: 'ocr',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .execute();

            // Update document status
            await db.updateTable('documents').set({ ocr_status: 'pending' }).where('id', '=', request.params.id).execute();

            return { job_id: jobId, status: 'pending' as const };
        },
    );

    // ==================== LLM Endpoints ====================

    // LLM Result schema for API responses
    const LlmResultSchema = z.object({
        document_id: z.string().uuid(),
        summary: z.string().nullable(),
        metadata: z
            .object({
                type: z.enum(['text_summary', 'vision_describe']).optional(),
                title: z.string().optional(),
                keyEntities: z.array(z.string()).optional(),
                topics: z.array(z.string()).optional(),
                documentType: z.string().optional(),
                sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
                truncated: z.boolean().optional(),
                samplingStrategy: z.enum(['full', 'start_end', 'distributed']).optional(),
                originalTextLength: z.number().optional(),
                skipped: z.boolean().optional(),
                skipReason: z.string().optional(),
            })
            .nullable(),
        processed_at: z.string().nullable(),
        token_count: z.number().nullable(),
    });

    // Trigger LLM processing for a document
    fastify.post<{
        Params: { id: string };
    }>(
        '/documents/:id/process-llm',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Trigger LLM processing for a document',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: z.object({
                        job_id: z.string(),
                        status: z.enum(['pending', 'processing', 'already_complete', 'not_eligible']),
                        reason: z.string().optional(),
                    }),
                    404: z.object({ message: z.string() }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            // Check if already processed
            if (document.llm_processed_at) {
                return { job_id: '', status: 'already_complete' as const };
            }

            // Check eligibility
            const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

            const eligibility = checkLlmEligibility(document, ocrResult);
            if (!eligibility.eligible) {
                return {
                    job_id: '',
                    status: 'not_eligible' as const,
                    reason: eligibility.reason,
                };
            }

            // Queue LLM job
            const jobId = `llm-${request.params.id}-${nanoid(6)}`;
            await addLlmJob(
                {
                    documentId: request.params.id,
                    type: eligibility.processingType === 'skip' ? undefined : eligibility.processingType,
                },
                jobId,
            );

            // Track in processing_jobs table
            await db
                .insertInto('processing_jobs')
                .values({
                    job_type: 'llm_summary',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .execute();

            return { job_id: jobId, status: 'pending' as const };
        },
    );

    // Get LLM result for a document
    fastify.get<{
        Params: { id: string };
    }>(
        '/documents/:id/llm',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get LLM processing result for a document',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: LlmResultSchema,
                    404: z.object({ message: z.string() }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            if (!document.llm_processed_at && !document.llm_metadata) {
                return reply.notFound('LLM result not found. Document may not have been processed yet.');
            }

            return {
                document_id: document.id,
                summary: document.llm_summary,
                metadata: document.llm_metadata,
                processed_at: document.llm_processed_at?.toISOString() ?? null,
                token_count: document.llm_token_count,
            };
        },
    );

    // Reprocess LLM for a document (force regeneration)
    fastify.post<{
        Params: { id: string };
    }>(
        '/documents/:id/reprocess-llm',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Force reprocess LLM for a document (regenerate summary)',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: z.object({
                        job_id: z.string(),
                        status: z.literal('pending'),
                    }),
                    404: z.object({ message: z.string() }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const document = await uploadService.getDocument(request.params.id, userId);
            if (!document) {
                return reply.notFound('Document not found');
            }

            // Clear existing LLM data
            await db
                .updateTable('documents')
                .set({
                    llm_summary: null,
                    llm_metadata: null,
                    llm_processed_at: null,
                    llm_token_count: null,
                })
                .where('id', '=', request.params.id)
                .execute();

            // Queue LLM job
            const jobId = `llm-reprocess-${request.params.id}-${nanoid(6)}`;
            await addLlmJob(
                {
                    documentId: request.params.id,
                },
                jobId,
            );

            // Track in processing_jobs table
            await db
                .insertInto('processing_jobs')
                .values({
                    job_type: 'llm_summary',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .execute();

            return { job_id: jobId, status: 'pending' as const };
        },
    );

    // Batch process multiple documents with LLM
    fastify.post<{
        Body: { document_ids: string[] };
    }>(
        '/documents/batch-process-llm',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Batch process multiple documents with LLM',
                body: z.object({
                    document_ids: z.array(UuidSchema).min(1).max(100),
                }),
                response: {
                    200: z.object({
                        job_ids: z.array(z.string()),
                        skipped: z.array(
                            z.object({
                                document_id: z.string().uuid(),
                                reason: z.string(),
                            }),
                        ),
                    }),
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const { document_ids } = request.body;

            const jobIds: string[] = [];
            const skipped: Array<{ document_id: string; reason: string }> = [];

            for (const documentId of document_ids) {
                // Verify document belongs to user
                const document = await uploadService.getDocument(documentId, userId);
                if (!document) {
                    skipped.push({ document_id: documentId, reason: 'not_found' });
                    continue;
                }

                // Skip if already processed
                if (document.llm_processed_at) {
                    skipped.push({ document_id: documentId, reason: 'already_processed' });
                    continue;
                }

                // Check eligibility
                const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', documentId).executeTakeFirst();

                const eligibility = checkLlmEligibility(document, ocrResult);
                if (!eligibility.eligible) {
                    skipped.push({ document_id: documentId, reason: eligibility.reason ?? 'not_eligible' });
                    continue;
                }

                // Queue LLM job
                const jobId = `llm-batch-${documentId}-${nanoid(6)}`;
                await addLlmJob(
                    {
                        documentId,
                        type: eligibility.processingType === 'skip' ? undefined : eligibility.processingType,
                    },
                    jobId,
                );

                // Track in processing_jobs table
                await db
                    .insertInto('processing_jobs')
                    .values({
                        job_type: 'llm_summary',
                        target_type: 'document',
                        target_id: documentId,
                        status: 'pending',
                    })
                    .execute();

                jobIds.push(jobId);
            }

            return { job_ids: jobIds, skipped };
        },
    );
}

function serializeDocument(doc: DbDocument): Document {
    return {
        id: doc.id,
        folder_id: doc.folder_id,
        file_path: doc.file_path,
        file_hash: doc.file_hash,
        original_filename: doc.original_filename,
        mime_type: doc.mime_type,
        size_bytes: Number(doc.size_bytes),
        width: doc.width,
        height: doc.height,
        thumbnail_blurhash: doc.thumbnail_blurhash,
        thumbnail_paths: doc.thumbnail_paths,
        document_category: doc.document_category as Document['document_category'],
        extracted_date: doc.extracted_date?.toISOString().split('T')[0] ?? null,
        ocr_status: doc.ocr_status as Document['ocr_status'],
        thumbnail_status: doc.thumbnail_status as Document['thumbnail_status'],
        llm_summary: doc.llm_summary,
        llm_metadata: doc.llm_metadata as Document['llm_metadata'],
        llm_processed_at: doc.llm_processed_at?.toISOString() ?? null,
        llm_token_count: doc.llm_token_count,
        created_at: doc.created_at.toISOString(),
        updated_at: doc.updated_at.toISOString(),
    };
}

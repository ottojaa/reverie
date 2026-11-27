import {
    BatchDeleteDocumentsSchema,
    CheckContentRequestSchema,
    CheckContentResponseSchema,
    CheckDuplicatesRequestSchema,
    CheckDuplicatesResponseSchema,
    DocumentListQuerySchema,
    DocumentSchema,
    DocumentSummaryQuerySchema,
    DocumentSummaryResponseSchema,
    EntitySchema,
    JobSchema,
    JobStatusEnum,
    MoveDocumentsRequestSchema,
    PaginatedResponseSchema,
    TrimVideoRequestSchema,
    TrimVideoResponseSchema,
    UpdateDocumentRequestSchema,
    UuidSchema,
    ValidationError,
    type CheckContentRequest,
    type CheckDuplicatesRequest,
    type Document,
    type DocumentListQuery,
    type DocumentSummaryQuery,
    type MoveDocumentsRequest,
} from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/kysely';
import { checkLlmEligibility } from '../../llm/eligibility';
import { isVisionSwitchedOn } from '../../llm/provider-config';
import { promoteToNormal } from '../../queues/lane';
import { addLlmJob } from '../../queues/llm.queue';
import { addOcrJob } from '../../queues/ocr.queue';
import { addTrimJob } from '../../queues/trim.queue';
import { findLiveFolder } from '../../services/folders/load';
import { checkContent } from '../../services/content-check';
import { loadOpenDocument } from '../../services/document-access';
import { loadFolderLocks } from '../../services/folder-locks';
import { serializeDocument } from '../../services/document-serializer';
import {
    applyDocumentListFilters,
    IS_SCREEN_CAPTURE_SQL,
    TAKEN_AT_SQL,
    type DocumentListFilters,
    CITY_SQL,
    applyDocumentListOrder,
} from '../../services/document-list-filters';
import { loadMediaDates, summariseDocuments } from '../../services/document-summary';
import { excludeTrashed } from '../../services/privacy';
import { getTrashService } from '../../services/trash.service';
import { getStorageService } from '../../services/storage.service';
import { getFileCategory } from '../../services/storage.service';
import { getUploadService, type UploadedFile } from '../../services/upload.service';
import { discardUploadedFiles, receiveUploadedFile } from '../../utils/upload-files';
import { getJobService } from '../../jobs/job.service';
import { loadDocumentTags } from '../../taught-labels/taught-labels.repository';
import { getDeduplicatedFilename } from '../../utils/filename';

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
        async function (request, reply) {
            const userId = request.user.id;
            const { limit, offset, folder_id, top_level, preview, category, date_from, date_to, processing, kind, media, sort } = request.query;

            if (folder_id && top_level) return reply.badRequest('Give folder_id or top_level, not both');

            if (kind && media) throw new ValidationError('Give kind or media, not both');

            // A private folder's documents are listed only by asking for that folder, once it is open.
            // Every other listing (no folder filter) leaves private folders out, locked or not.
            const locks = await loadFolderLocks(fastify, request, userId);
            locks.assertOpen(folder_id ?? null);

            const filters: DocumentListFilters = {
                userId,
                folderId: folder_id,
                topLevel: top_level,
                privateFolderIds: locks.privateFolderIds,
                category,
                dateFrom: date_from,
                dateTo: date_to,
                processing,
                kind,
                media,
            };
            const byDateTaken = media || kind === 'image' || kind === 'video';
            const withPhotoFacts = db
                .selectFrom('documents')
                .selectAll()
                .select([TAKEN_AT_SQL.as('taken_at'), CITY_SQL.as('city')]);
            const page = applyDocumentListFilters(withPhotoFacts, filters);
            // A preview is a few cards standing for a kind: screenshots and screen recordings come after the rest.
            const ranked = preview && kind ? page.orderBy(IS_SCREEN_CAPTURE_SQL) : page;
            const orderedPage = applyDocumentListOrder(ranked, sort, byDateTaken);
            const count = applyDocumentListFilters(db.selectFrom('documents').select(db.fn.countAll().as('count')), filters);

            const [documents, countResult] = await Promise.all([orderedPage.limit(limit).offset(offset).execute(), count.executeTakeFirst()]);

            // Rows only get here once their folder is known to be open, so serializing signs their URLs.
            const serializedDocuments = await Promise.all(documents.map((doc) => serializeDocument(doc, locks)));

            return {
                items: serializedDocuments,
                total: Number(countResult?.count ?? 0),
                limit,
                offset,
            };
        },
    );

    // What the library (or one folder) holds per kind: the Browse dashboard's cards (requires authentication)
    fastify.get<{
        Querystring: DocumentSummaryQuery;
    }>(
        '/documents/summary',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Count and size per document kind, and the most common file types',
                querystring: DocumentSummaryQuerySchema,
                response: {
                    200: DocumentSummaryResponseSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { folder_id, top_level } = request.query;

            if (folder_id && top_level) return reply.badRequest('Give folder_id or top_level, not both');

            const locks = await loadFolderLocks(fastify, request, userId);
            locks.assertOpen(folder_id ?? null);

            const scope = { userId, folderId: folder_id, topLevel: top_level, privateFolderIds: locks.privateFolderIds };
            // Only a folder's page says when its photos and videos were taken; a wider scope is asked for counts alone.
            const [summary, mediaDates] = await Promise.all([summariseDocuments(scope), folder_id ? loadMediaDates(scope) : null]);

            return { ...summary, media_dates: mediaDates };
        },
    );

    // Check for duplicate filenames in a folder (requires authentication)
    fastify.post<{
        Body: CheckDuplicatesRequest;
        Reply: { duplicates: string[] };
    }>(
        '/documents/check-duplicates',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Check which filenames already exist in the given folder, or at the top level',
                body: CheckDuplicatesRequestSchema,
                response: {
                    200: CheckDuplicatesResponseSchema,
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const { filenames } = request.body;
            const folderId = request.body.folder_id ?? null;

            if (filenames.length === 0) {
                return { duplicates: [] };
            }

            (await loadFolderLocks(fastify, request, userId)).assertOpen(folderId);

            const existing = await excludeTrashed(
                db
                    .selectFrom('documents')
                    .select('original_filename')
                    .where('folder_id', folderId === null ? 'is' : '=', folderId)
                    .where('user_id', '=', userId)
                    .where('original_filename', 'in', filenames),
                '',
            ).execute();

            const duplicates = [...new Set(existing.map((r) => r.original_filename))];

            return { duplicates };
        },
    );

    // Check which files' content is already in the library, by SHA-256 (requires authentication)
    fastify.post<{
        Body: CheckContentRequest;
    }>(
        '/documents/check-content',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: "Check which files' content (SHA-256) is already in the library, and which names are taken in the target folder",
                body: CheckContentRequestSchema,
                response: {
                    200: CheckContentResponseSchema,
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const { folder_id } = request.body;

            if (folder_id) (await loadFolderLocks(fastify, request, userId)).assertOpen(folder_id);

            return { results: await checkContent(userId, request.body) };
        },
    );

    // Move documents into a folder or to the top level (requires authentication)
    fastify.patch<{
        Body: MoveDocumentsRequest;
    }>(
        '/documents/move',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Move documents into a folder, or to the top level',
                body: MoveDocumentsRequestSchema,
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { document_ids, folder_id, conflict_strategy } = request.body;

            if (folder_id !== null && !(await findLiveFolder(userId, folder_id))) {
                return reply.notFound('Folder not found');
            }

            if (document_ids.length === 0) {
                return reply.status(204).send();
            }

            const docsToMove = await excludeTrashed(
                db.selectFrom('documents').select(['id', 'original_filename', 'folder_id']).where('id', 'in', document_ids).where('user_id', '=', userId),
                '',
            )
                .orderBy('id')
                .execute();

            if (docsToMove.length === 0) {
                return reply.status(204).send();
            }

            // Moving out of a locked folder would turn its documents public, so the source locks must be open,
            // and writing into a locked folder needs it open too.
            const locks = await loadFolderLocks(fastify, request, userId);
            locks.assertAllOpen([folder_id, ...docsToMove.map((doc) => doc.folder_id)]);

            if (conflict_strategy === 'replace') {
                const filenames = docsToMove.map((d) => d.original_filename);
                await uploadService.trashDocumentsInFolderByFilenames(userId, folder_id, filenames);
            }

            if (conflict_strategy === 'keep_both') {
                const existingFilenames = await uploadService.getFilenamesInFolder(userId, folder_id);
                const taken = new Set(existingFilenames);

                for (const doc of docsToMove) {
                    const newName = getDeduplicatedFilename([...taken], doc.original_filename);
                    taken.add(newName);
                    await db
                        .updateTable('documents')
                        .set({ folder_id, original_filename: newName, updated_at: new Date() })
                        .where('id', '=', doc.id)
                        .where('user_id', '=', userId)
                        .execute();
                }
            } else {
                await excludeTrashed(
                    db.updateTable('documents').set({ folder_id, updated_at: new Date() }).where('id', 'in', document_ids).where('user_id', '=', userId),
                    '',
                ).execute();
            }

            reply.status(204).send();
        },
    );

    // Get document thumbnail (requires authentication)
    fastify.get<{
        Params: { id: string; size: 'sm' | 'md' | 'lg' };
    }>(
        '/documents/:id/thumbnail/:size',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get document thumbnail',
                params: z.object({
                    id: UuidSchema,
                    size: z.enum(['sm', 'md', 'lg']),
                }),
            },
        },
        async function (request, reply) {
            const { document, locks } = await loadOpenDocument(fastify, request, request.params.id);

            if (!document.thumbnail_paths) {
                return reply.notFound('Thumbnail not available');
            }

            const thumbnailPath = document.thumbnail_paths[request.params.size];

            if (!thumbnailPath) {
                return reply.notFound('Thumbnail size not available');
            }

            try {
                const buffer = await storageService.readFile(thumbnailPath);
                reply.header('Content-Type', 'image/webp');
                // A private thumbnail must not outlive its lock in a browser or app disk cache.
                reply.header('Cache-Control', locks.isPrivate(document.folder_id) ? 'private, no-store' : 'public, max-age=31536000');

                return reply.send(buffer);
            } catch {
                return reply.notFound('Thumbnail file not found');
            }
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
        async function (request) {
            const { document, locks } = await loadOpenDocument(fastify, request, request.params.id);

            const llmResult = await db.selectFrom('llm_results').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();
            const photoMeta = await db.selectFrom('photo_metadata').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

            const videoMeta = await db.selectFrom('video_metadata').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

            const tags = await loadDocumentTags(db, request.user.id, request.params.id);

            return { ...(await serializeDocument(document, locks, llmResult, photoMeta ?? null, videoMeta ?? null)), tags };
        },
    );

    // Update document (rename) (requires authentication)
    fastify.patch<{
        Params: { id: string };
        Body: { original_filename: string };
        Reply: Document;
    }>(
        '/documents/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Update document metadata (rename)',
                params: z.object({ id: UuidSchema }),
                body: UpdateDocumentRequestSchema,
                response: {
                    200: DocumentSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { document, locks } = await loadOpenDocument(fastify, request, request.params.id);

            const { original_filename } = request.body;

            const existing = await excludeTrashed(
                db
                    .selectFrom('documents')
                    .select('id')
                    .where('folder_id', document.folder_id === null ? 'is' : '=', document.folder_id)
                    .where('user_id', '=', userId)
                    .where('original_filename', '=', original_filename)
                    .where('id', '!=', request.params.id),
                '',
            ).executeTakeFirst();

            if (existing) {
                return reply.conflict('A document with this filename already exists in this folder');
            }

            await db
                .updateTable('documents')
                .set({ original_filename, updated_at: new Date() })
                .where('id', '=', request.params.id)
                .where('user_id', '=', userId)
                .execute();

            const updated = await uploadService.getDocument(request.params.id, userId);
            const llmResult = await db.selectFrom('llm_results').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

            return await serializeDocument(updated!, locks, llmResult);
        },
    );

    // Replace document file (requires authentication)
    fastify.patch<{
        Params: { id: string };
        Reply: Document;
    }>(
        '/documents/:id/file',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Replace document file content',
                consumes: ['multipart/form-data'],
                params: z.object({ id: UuidSchema }),
                response: {
                    200: DocumentSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { locks } = await loadOpenDocument(fastify, request, request.params.id);

            const parts = request.parts();
            let file: UploadedFile | null = null;

            try {
                for await (const part of parts) {
                    if (part.type === 'file' && part.fieldname === 'file') {
                        file = await receiveUploadedFile(part);
                        break;
                    }
                }

                if (!file) {
                    return reply.badRequest('No file provided. Send multipart form with field "file".');
                }

                const updated = await uploadService.replaceDocumentFile(request.params.id, userId, file);
                const llmResult = await db.selectFrom('llm_results').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

                return await serializeDocument(updated, locks, llmResult);
            } finally {
                // The stored file is moved out of the temp dir; this cleans up when something failed before that
                if (file) await discardUploadedFiles([file]);
            }
        },
    );

    // Trim video (requires authentication)
    fastify.post<{
        Params: { id: string };
        Body: z.infer<typeof TrimVideoRequestSchema>;
        Reply: z.infer<typeof TrimVideoResponseSchema>;
    }>(
        '/documents/:id/trim',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Trim video - creates background job',
                params: z.object({ id: UuidSchema }),
                body: TrimVideoRequestSchema,
                response: {
                    200: TrimVideoResponseSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { document } = await loadOpenDocument(fastify, request, request.params.id);

            const isVideo =
                getFileCategory(document.mime_type) === 'video' ||
                ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'].includes(
                    document.original_filename.toLowerCase().slice(document.original_filename.lastIndexOf('.')),
                );

            if (!isVideo) {
                return reply.badRequest('Document is not a video');
            }

            const body = TrimVideoRequestSchema.parse(request.body);

            const jobService = getJobService();
            const job = await jobService.createJob({
                userId,
                jobType: 'video_trim',
                targetType: 'document',
                targetId: document.id,
                priority: 5,
            });

            await promoteToNormal(document.id);
            await addTrimJob(
                {
                    documentId: document.id,
                    userId,
                    start: body.start,
                    end: body.end,
                    saveAsCopy: body.saveAsCopy,
                    sessionId: body.sessionId,
                },
                job.id,
            );

            return { jobId: job.id };
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
                description: 'Move a document to the trash',
                params: z.object({ id: UuidSchema }),
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { document } = await loadOpenDocument(fastify, request, request.params.id);

            await getTrashService().trashDocuments(userId, [document.id]);

            reply.status(204).send();
        },
    );

    // Batch delete documents (requires authentication)
    fastify.delete<{
        Body: { ids: string[] };
    }>(
        '/documents',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Move multiple documents to the trash',
                body: BatchDeleteDocumentsSchema,
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const ids = request.body.ids;

            const documents = await Promise.all(ids.map((id) => uploadService.getDocument(id, userId)));
            const found = documents.filter((d): d is NonNullable<typeof d> => d != null);

            if (found.length === 0) {
                return reply.notFound('No documents found');
            }

            (await loadFolderLocks(fastify, request, userId)).assertAllOpen(found.map((d) => d.folder_id));

            await getTrashService().trashDocuments(
                userId,
                found.map((d) => d.id),
            );

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
                        ocr_status: JobStatusEnum,
                        thumbnail_status: JobStatusEnum,
                        llm_status: JobStatusEnum,
                        jobs: z.array(
                            z.object({
                                type: z.string(),
                                status: JobStatusEnum,
                                completed_at: z.string().nullable(),
                            }),
                        ),
                    }),
                },
            },
        },
        async function (request) {
            const { document } = await loadOpenDocument(fastify, request, request.params.id);

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
                llm_status: document.llm_status,
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
                    200: z.array(JobSchema),
                },
            },
        },
        async function (request) {
            await loadOpenDocument(fastify, request, request.params.id);

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
        async function (request) {
            const userId = request.user.id;
            const { document } = await loadOpenDocument(fastify, request, request.params.id);

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

            // Create processing_job first (UUID required for worker tracking)
            const createdJob = await db
                .insertInto('processing_jobs')
                .values({
                    user_id: userId,
                    job_type: 'ocr',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            await promoteToNormal(request.params.id);
            await addOcrJob(
                {
                    documentId: request.params.id,
                    userId,
                    filePath: document.file_path,
                },
                createdJob.id,
            );

            // Update document status
            await db.updateTable('documents').set({ ocr_status: 'pending' }).where('id', '=', request.params.id).execute();

            return { job_id: createdJob.id, status: 'pending' as const };
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
            await loadOpenDocument(fastify, request, request.params.id);

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
        async function (request) {
            const userId = request.user.id;
            const { document } = await loadOpenDocument(fastify, request, request.params.id);

            // Create processing_job first (UUID required for worker tracking)
            const createdJob = await db
                .insertInto('processing_jobs')
                .values({
                    user_id: userId,
                    job_type: 'ocr',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            await promoteToNormal(request.params.id);
            await addOcrJob(
                {
                    documentId: request.params.id,
                    userId,
                    filePath: document.file_path,
                    forceReprocess: true,
                },
                createdJob.id,
            );

            await db.updateTable('documents').set({ ocr_status: 'pending' }).where('id', '=', request.params.id).execute();

            return { job_id: createdJob.id, status: 'pending' as const };
        },
    );

    // ==================== LLM Endpoints ====================

    // LLM Result schema for API responses
    const LlmResultSchema = z.object({
        document_id: z.string().uuid(),
        summary: z.string().nullable(),
        metadata: z
            .object({
                type: z.enum(['text_summary', 'image_understanding', 'vision_describe']).optional(),
                title: z.string().optional(),
                appOrSource: z.string().optional(),
                imageKind: z.string().optional(),
                entities: z.array(EntitySchema).optional(),
                topics: z.array(z.string()).optional(),
                documentType: z.string().optional(),
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
        async function (request) {
            const userId = request.user.id;
            const { document, locks } = await loadOpenDocument(fastify, request, request.params.id);

            // Check if already processed
            const existingLlmResult = await db.selectFrom('llm_results').select('id').where('document_id', '=', request.params.id).executeTakeFirst();

            if (existingLlmResult) {
                return { job_id: '', status: 'already_complete' as const };
            }

            // Check eligibility
            const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

            const eligibility = checkLlmEligibility(document, ocrResult, {
                isPrivate: locks.isPrivate(document.folder_id),
                vision: await isVisionSwitchedOn(),
            });

            if (!eligibility.eligible) {
                return {
                    job_id: '',
                    status: 'not_eligible' as const,
                    reason: eligibility.reason,
                };
            }

            await db.updateTable('documents').set({ llm_status: 'pending' }).where('id', '=', request.params.id).execute();

            const createdJob = await db
                .insertInto('processing_jobs')
                .values({
                    user_id: userId,
                    job_type: 'llm_summary',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            await promoteToNormal(request.params.id);
            await addLlmJob(
                {
                    documentId: request.params.id,
                    userId,
                    type: eligibility.processingType === 'skip' ? undefined : eligibility.processingType,
                },
                createdJob.id,
            );

            return { job_id: createdJob.id, status: 'pending' as const };
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
            const { document } = await loadOpenDocument(fastify, request, request.params.id);

            const llmResult = await db.selectFrom('llm_results').selectAll().where('document_id', '=', request.params.id).executeTakeFirst();

            if (!llmResult) {
                return reply.notFound('LLM result not found. Document may not have been processed yet.');
            }

            return {
                document_id: document.id,
                summary: llmResult.summary,
                metadata: llmResult.metadata,
                processed_at: llmResult.processed_at.toISOString(),
                token_count: llmResult.token_count,
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
        async function (request) {
            const userId = request.user.id;
            await loadOpenDocument(fastify, request, request.params.id);

            // Clear existing LLM result and set status to pending
            await db.deleteFrom('llm_results').where('document_id', '=', request.params.id).execute();

            await db.updateTable('documents').set({ llm_status: 'pending' }).where('id', '=', request.params.id).execute();

            // Create processing_job first (UUID required for worker tracking)
            const createdJob = await db
                .insertInto('processing_jobs')
                .values({
                    user_id: userId,
                    job_type: 'llm_summary',
                    target_type: 'document',
                    target_id: request.params.id,
                    status: 'pending',
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            await promoteToNormal(request.params.id);
            await addLlmJob(
                {
                    documentId: request.params.id,
                    userId,
                },
                createdJob.id,
            );

            return { job_id: createdJob.id, status: 'pending' as const };
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
            const locks = await loadFolderLocks(fastify, request, userId);

            for (const documentId of document_ids) {
                // Verify document belongs to user
                const document = await uploadService.getDocument(documentId, userId);

                if (!document) {
                    skipped.push({ document_id: documentId, reason: 'not_found' });
                    continue;
                }

                if (locks.isLocked(document.folder_id)) {
                    skipped.push({ document_id: documentId, reason: 'not_found' });
                    continue;
                }

                // Skip if already processed
                const existingResult = await db.selectFrom('llm_results').select('id').where('document_id', '=', documentId).executeTakeFirst();

                if (existingResult) {
                    skipped.push({ document_id: documentId, reason: 'already_processed' });
                    continue;
                }

                // Check eligibility
                const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', documentId).executeTakeFirst();

                const eligibility = checkLlmEligibility(document, ocrResult, {
                    isPrivate: locks.isPrivate(document.folder_id),
                    vision: await isVisionSwitchedOn(),
                });

                if (!eligibility.eligible) {
                    skipped.push({ document_id: documentId, reason: eligibility.reason ?? 'not_eligible' });
                    continue;
                }

                await db.updateTable('documents').set({ llm_status: 'pending' }).where('id', '=', documentId).execute();

                const createdJob = await db
                    .insertInto('processing_jobs')
                    .values({
                        user_id: userId,
                        job_type: 'llm_summary',
                        target_type: 'document',
                        target_id: documentId,
                        status: 'pending',
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow();

                await promoteToNormal(documentId);
                await addLlmJob(
                    {
                        documentId,
                        userId,
                        type: eligibility.processingType === 'skip' ? undefined : eligibility.processingType,
                    },
                    createdJob.id,
                );

                jobIds.push(createdJob.id);
            }

            return { job_ids: jobIds, skipped };
        },
    );
}

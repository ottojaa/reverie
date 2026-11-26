import { NotFoundError, UploadResponseSchema, ValidationError, type UploadResponse } from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import { assertDocumentsOpen } from '../../services/document-access';
import { loadFolderLocks } from '../../services/folder-locks';
import { findLiveFolder } from '../../services/folders/load';
import { getUploadService, type ConflictStrategy, type UploadedFile } from '../../services/upload.service';
import { discardUploadedFiles, receiveUploadedFile } from '../../utils/upload-files';

const uploadService = getUploadService();

export default async function (fastify: FastifyInstance) {
    // Upload images endpoint (requires authentication)
    fastify.post<{
        Body: { folder_id?: string };
        Reply: UploadResponse;
    }>(
        '/upload',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Upload one or more files (any type)',
                consumes: ['multipart/form-data'],
                // Note: body schema removed - multipart form-data is parsed manually via request.parts()
                response: {
                    200: UploadResponseSchema,
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const files: UploadedFile[] = [];

            try {
                const parts = request.parts();
                let folderId: string | undefined;
                let sessionId: string | undefined;
                let conflictStrategy: ConflictStrategy | undefined;
                let copyMetadataFromDocumentId: string | undefined;

                for await (const part of parts) {
                    if (part.type === 'file') {
                        // Streamed to disk, never buffered in memory (files can be many GB)
                        files.push(await receiveUploadedFile(part));
                    } else if (part.fieldname === 'folder_id' && part.value) {
                        folderId = String(part.value);
                    } else if (part.fieldname === 'session_id' && part.value) {
                        sessionId = String(part.value);
                    } else if (part.fieldname === 'conflict_strategy' && part.value) {
                        const v = String(part.value);

                        if (v === 'replace' || v === 'keep_both') conflictStrategy = v;
                    } else if (part.fieldname === 'copy_metadata_from_document_id' && part.value) {
                        copyMetadataFromDocumentId = String(part.value);
                    }
                }

                if (files.length === 0) throw new ValidationError('No files provided');

                // No folder_id means the top level.
                if (folderId && !(await findLiveFolder(userId, folderId))) throw new NotFoundError('Folder', folderId);

                // Uploading into a locked folder would reveal its filenames (duplicate handling); copying
                // metadata reads another document. Both need the folder's lock open.
                const locks = await loadFolderLocks(fastify, request, userId);
                locks.assertOpen(folderId ?? null);

                if (copyMetadataFromDocumentId) await assertDocumentsOpen(locks, userId, [copyMetadataFromDocumentId]);

                const result = await uploadService.uploadFiles(files, userId, folderId, sessionId, conflictStrategy, copyMetadataFromDocumentId);

                return {
                    session_id: result.sessionId,
                    documents: result.documents.map((doc) => ({
                        id: doc.id,
                        original_filename: doc.original_filename,
                        mime_type: doc.mime_type,
                        size_bytes: Number(doc.size_bytes),
                        folder_id: doc.folder_id,
                        file_path: doc.file_path,
                        created_at: doc.created_at.toISOString(),
                    })),
                    jobs: result.jobs.map((job) => ({
                        id: job.id,
                        job_type: job.job_type as 'ocr' | 'thumbnail' | 'llm_summary',
                        target_type: 'document' as const,
                        target_id: job.target_id,
                        status: job.status as 'pending' | 'processing' | 'complete' | 'failed',
                        priority: 0,
                        attempts: 0,
                        error_message: null,
                        result: null,
                        created_at: new Date().toISOString(),
                        started_at: null,
                        completed_at: null,
                    })),
                };
            } finally {
                // Files that were stored have already been moved out of the temp dir; this removes the rest
                // (failed validation, quota exceeded, aborted requests, ...).
                await discardUploadedFiles(files);
            }
        },
    );
}

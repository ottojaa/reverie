import { UploadRequestSchema, UploadResponseSchema, type UploadResponse } from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import { getUploadService, type UploadedFile } from '../../services/upload.service';

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
                description: 'Upload one or more images',
                consumes: ['multipart/form-data'],
                body: UploadRequestSchema,
                response: {
                    200: UploadResponseSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const parts = request.parts();
            const files: UploadedFile[] = [];
            let folderId: string | undefined;

            for await (const part of parts) {
                if (part.type === 'file') {
                    const buffer = await part.toBuffer();
                    files.push({
                        buffer,
                        filename: part.filename,
                        mimetype: part.mimetype,
                    });
                } else if (part.fieldname === 'folder_id' && part.value) {
                    folderId = String(part.value);
                }
            }

            if (files.length === 0) {
                return reply.badRequest('No files provided');
            }

            // Validate file types
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            for (const file of files) {
                if (!allowedTypes.includes(file.mimetype)) {
                    return reply.badRequest(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedTypes.join(', ')}`);
                }
            }

            const result = await uploadService.uploadFiles(files, userId, folderId);

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
        },
    );
}

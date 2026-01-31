import { randomUUID } from 'crypto';
import { db } from '../db/kysely';
import type { Document, NewDocument, NewProcessingJob } from '../db/schema';
import { addOcrJob } from '../queues/ocr.queue';
import { addThumbnailJob } from '../queues/thumbnail.queue';
import { getStorageService, type UserStorageContext } from './storage.service';

export interface UploadedFile {
    buffer: Buffer;
    filename: string;
    mimetype: string;
}

export interface UploadResult {
    sessionId: string;
    documents: Document[];
    jobs: Array<{
        id: string;
        job_type: string;
        status: string;
        target_id: string;
    }>;
}

export class UploadService {
    private storageService = getStorageService();

    /**
     * Upload multiple files (with user context for storage quotas)
     */
    async uploadFiles(files: UploadedFile[], userId: string, folderId?: string): Promise<UploadResult> {
        const sessionId = randomUUID();
        const documents: Document[] = [];
        const jobs: Array<{ id: string; job_type: string; status: string; target_id: string }> = [];

        // Get user storage context once for all files
        const userContext = await this.storageService.getUserStorageContext(userId);

        for (const file of files) {
            const result = await this.uploadSingleFile(file, userId, userContext, folderId, sessionId);
            documents.push(result.document);
            jobs.push(...result.jobs);

            // Update context's used bytes for accurate quota checking on subsequent files
            userContext.storageUsedBytes += file.buffer.length;
        }

        return {
            sessionId,
            documents,
            jobs,
        };
    }

    /**
     * Upload a single file
     */
    private async uploadSingleFile(
        file: UploadedFile,
        userId: string,
        userContext: UserStorageContext,
        folderId: string | undefined,
        sessionId: string,
    ): Promise<{ document: Document; jobs: Array<{ id: string; job_type: string; status: string; target_id: string }> }> {
        // Process and store the image (with user context for quotas)
        const processed = await this.storageService.processAndStoreImage(file.buffer, file.filename, file.mimetype, userContext);

        // Check for duplicate by hash (scoped to user)
        const existing = await db.selectFrom('documents').selectAll().where('file_hash', '=', processed.hash).where('user_id', '=', userId).executeTakeFirst();

        if (existing) {
            // Return existing document without creating new jobs
            return {
                document: existing,
                jobs: [],
            };
        }

        // Create document record (with user_id)
        const newDocument: NewDocument = {
            user_id: userId,
            folder_id: folderId ?? null,
            file_path: processed.storagePath,
            file_hash: processed.hash,
            original_filename: file.filename,
            mime_type: file.mimetype,
            size_bytes: file.buffer.length,
            width: processed.width,
            height: processed.height,
            thumbnail_blurhash: processed.blurhash,
            ocr_status: 'pending',
            thumbnail_status: 'pending',
        };

        const document = await db.insertInto('documents').values(newDocument).returningAll().executeTakeFirstOrThrow();

        // Create processing jobs and enqueue to BullMQ
        const jobTypes: Array<'ocr' | 'thumbnail'> = ['ocr', 'thumbnail'];
        const createdJobs: Array<{ id: string; job_type: string; status: string; target_id: string }> = [];

        for (const jobType of jobTypes) {
            const newJob: NewProcessingJob = {
                job_type: jobType,
                target_type: 'document',
                target_id: document.id,
                status: 'pending',
                priority: jobType === 'thumbnail' ? 10 : 0, // Thumbnails have higher priority
            };

            const job = await db.insertInto('processing_jobs').values(newJob).returning(['id', 'job_type', 'status', 'target_id']).executeTakeFirstOrThrow();

            createdJobs.push(job);

            // Enqueue job to BullMQ
            if (jobType === 'ocr') {
                await addOcrJob(
                    {
                        documentId: document.id,
                        sessionId,
                        filePath: document.file_path,
                    },
                    job.id,
                );
            } else if (jobType === 'thumbnail') {
                await addThumbnailJob(
                    {
                        documentId: document.id,
                        sessionId,
                        filePath: document.file_path,
                    },
                    job.id,
                );
            }
        }

        return {
            document,
            jobs: createdJobs,
        };
    }

    /**
     * Get document by ID (scoped to user)
     */
    async getDocument(id: string, userId: string): Promise<Document | undefined> {
        return db.selectFrom('documents').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    }

    /**
     * Get documents in a folder (scoped to user)
     */
    async getDocumentsInFolder(userId: string, folderId: string | null, limit = 20, offset = 0): Promise<{ documents: Document[]; total: number }> {
        const query = db
            .selectFrom('documents')
            .selectAll()
            .where('user_id', '=', userId)
            .$if(folderId === null, (qb) => qb.where('folder_id', 'is', null))
            .$if(folderId !== null, (qb) => qb.where('folder_id', '=', folderId!));

        const [documents, countResult] = await Promise.all([
            query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
            db
                .selectFrom('documents')
                .where('user_id', '=', userId)
                .$if(folderId === null, (qb) => qb.where('folder_id', 'is', null))
                .$if(folderId !== null, (qb) => qb.where('folder_id', '=', folderId!))
                .select(db.fn.countAll().as('count'))
                .executeTakeFirst(),
        ]);

        return {
            documents,
            total: Number(countResult?.count ?? 0),
        };
    }
}

// Singleton instance
let uploadServiceInstance: UploadService | null = null;

export function getUploadService(): UploadService {
    if (!uploadServiceInstance) {
        uploadServiceInstance = new UploadService();
    }
    return uploadServiceInstance;
}

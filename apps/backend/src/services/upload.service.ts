import { randomUUID } from 'crypto';
import { extname } from 'path';
import { db } from '../db/kysely';
import type { Document, NewDocument, NewProcessingJob } from '../db/schema';
import { addOcrJob } from '../queues/ocr.queue';
import { addThumbnailJob } from '../queues/thumbnail.queue';
import { getDeduplicatedFilename } from '../utils/filename';
import { canGenerateThumbnail, getStorageService, type UserStorageContext } from './storage.service';

export type ConflictStrategy = 'replace' | 'keep_both';

/**
 * Extension-to-MIME fallback for files where the browser reports a generic type
 * (e.g. application/octet-stream). Only covers types commonly misreported.
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
    // Video
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.m4v': 'video/x-m4v',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    // Image (rare misdetections)
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    // Documents
    '.pdf': 'application/pdf',
};

/**
 * Correct generic/missing MIME types using file extension.
 * Trusts the browser-reported type unless it's a catch-all like application/octet-stream.
 */
function correctMimeType(filename: string, reportedMime: string): string {
    if (reportedMime && reportedMime !== 'application/octet-stream') {
        return reportedMime;
    }

    const ext = extname(filename).toLowerCase();

    return EXTENSION_MIME_MAP[ext] ?? reportedMime;
}

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
     * @param clientSessionId - Optional client-provided session ID for WebSocket correlation (avoids race with job events)
     * @param conflictStrategy - When 'replace', delete existing docs in folder with same filename first. When 'keep_both', auto-rename with (n) suffix.
     * @param copyMetadataFromDocumentId - When set, copy photo_metadata from this document to each newly created document (for save-as-copy from image editor).
     */
    async uploadFiles(
        files: UploadedFile[],
        userId: string,
        folderId?: string,
        clientSessionId?: string,
        conflictStrategy?: ConflictStrategy,
        copyMetadataFromDocumentId?: string,
    ): Promise<UploadResult> {
        const sessionId = clientSessionId ?? randomUUID();
        const resolvedFolderId = folderId ?? null;

        if (conflictStrategy === 'replace' && resolvedFolderId) {
            await this.deleteDocumentsInFolderByFilenames(userId, resolvedFolderId, files.map((f) => f.filename));
        }

        let effectiveFilenames: string[] | undefined;

        if (conflictStrategy === 'keep_both' && resolvedFolderId) {
            const existing = await this.getFilenamesInFolder(userId, resolvedFolderId);
            effectiveFilenames = [];
            const taken = new Set(existing);

            for (const file of files) {
                const name = getDeduplicatedFilename([...taken], file.filename);
                effectiveFilenames.push(name);
                taken.add(name);
            }
        }

        const documents: Document[] = [];
        const jobs: Array<{ id: string; job_type: string; status: string; target_id: string }> = [];
        const userContext = await this.storageService.getUserStorageContext(userId);
        const skipHashDuplicate = conflictStrategy != null;

        const promises = files.map(async (file, index) => {
            const effectiveFilename = effectiveFilenames?.[index] ?? file.filename;
            const result = await this.uploadSingleFile(
                file,
                userId,
                userContext,
                resolvedFolderId ?? undefined,
                sessionId,
                effectiveFilename,
                skipHashDuplicate,
                copyMetadataFromDocumentId,
            );
            documents.push(result.document);
            jobs.push(...result.jobs);
            userContext.storageUsedBytes += file.buffer.length;
        });

        await Promise.all(promises);

        return {
            sessionId,
            documents,
            jobs,
        };
    }

    /**
     * Get original_filename of all documents in a folder (for duplicate naming).
     */
    async getFilenamesInFolder(userId: string, folderId: string): Promise<string[]> {
        const rows = await db
            .selectFrom('documents')
            .select('original_filename')
            .where('user_id', '=', userId)
            .where('folder_id', '=', folderId)
            .execute();

        return rows.map((r) => r.original_filename);
    }

    /**
     * Delete documents in folder that have one of the given filenames (used for replace strategy).
     */
    async deleteDocumentsInFolderByFilenames(userId: string, folderId: string, filenames: string[]): Promise<void> {
        if (filenames.length === 0) return;

        const docs = await db
            .selectFrom('documents')
            .selectAll()
            .where('user_id', '=', userId)
            .where('folder_id', '=', folderId)
            .where('original_filename', 'in', filenames)
            .execute();

        for (const doc of docs) {
            await db.transaction().execute(async (trx) => {
                await trx
                    .deleteFrom('processing_jobs')
                    .where('target_type', '=', 'document')
                    .where('target_id', '=', doc.id)
                    .execute();
                await trx.deleteFrom('documents').where('id', '=', doc.id).where('user_id', '=', userId).execute();
            });

            try {
                await this.storageService.deleteFile(doc.file_path, userId);

                if (doc.thumbnail_paths) {
                    for (const path of Object.values(doc.thumbnail_paths)) {
                        await this.storageService.deleteFile(path, userId);
                    }
                }
            } catch (err) {
                console.error('Failed to delete file from storage:', err);
            }
        }
    }

    /**
     * Upload a single file
     * @param effectiveFilename - Used for original_filename when doing keep_both (renamed with (n) suffix)
     * @param skipHashDuplicate - When true, do not short-circuit on hash match (used when user chose replace/keep_both)
     * @param copyMetadataFromDocumentId - When set, copy photo_metadata from this document to the new document
     */
    private async uploadSingleFile(
        file: UploadedFile,
        userId: string,
        userContext: UserStorageContext,
        folderId: string | undefined,
        sessionId: string,
        effectiveFilename?: string,
        skipHashDuplicate?: boolean,
        copyMetadataFromDocumentId?: string,
    ): Promise<{ document: Document; jobs: Array<{ id: string; job_type: string; status: string; target_id: string }> }> {
        const displayName = effectiveFilename ?? file.filename;

        // Correct generic MIME types (e.g. application/octet-stream for .mov files)
        const mimeType = correctMimeType(file.filename, file.mimetype);

        // Process and store the file (with user context for quotas)
        const processed = await this.storageService.processAndStoreFile(file.buffer, file.filename, mimeType, userContext);

        if (!skipHashDuplicate) {
            // Check for duplicate by hash in the *target folder* only.
            // Same hash in a different folder = upload fresh copy to this folder.
            const hashQuery = db
                .selectFrom('documents')
                .selectAll()
                .where('file_hash', '=', processed.hash)
                .where('user_id', '=', userId);

            const existing = await (folderId != null ? hashQuery.where('folder_id', '=', folderId) : hashQuery.where('folder_id', 'is', null)).executeTakeFirst();

            if (existing) {
                return {
                    document: existing,
                    jobs: [],
                };
            }
        }

        // Determine if we can generate thumbnails for this file type
        const canThumbnail = canGenerateThumbnail(mimeType);

        // Create document record (with user_id)
        const newDocument: NewDocument = {
            user_id: userId,
            folder_id: folderId ?? null,
            file_path: processed.storagePath,
            file_hash: processed.hash,
            original_filename: displayName,
            mime_type: mimeType,
            size_bytes: file.buffer.length,
            width: processed.width,
            height: processed.height,
            thumbnail_blurhash: processed.blurhash,
            ocr_status: 'pending',
            llm_status: 'skipped',
            // For files that can't have thumbnails, mark as complete immediately
            thumbnail_status: canThumbnail ? 'pending' : 'complete',
        };

        const document = await db.insertInto('documents').values(newDocument).returningAll().executeTakeFirstOrThrow();

        // Copy photo_metadata from source document (for save-as-copy from image editor)
        if (copyMetadataFromDocumentId) {
            const sourceDoc = await db
                .selectFrom('documents')
                .select('id')
                .where('id', '=', copyMetadataFromDocumentId)
                .where('user_id', '=', userId)
                .executeTakeFirst();

            if (sourceDoc) {
                const sourceMetadata = await db
                    .selectFrom('photo_metadata')
                    .select(['latitude', 'longitude', 'country', 'city', 'taken_at'])
                    .where('document_id', '=', copyMetadataFromDocumentId)
                    .executeTakeFirst();

                if (sourceMetadata && (sourceMetadata.latitude != null || sourceMetadata.longitude != null || sourceMetadata.city != null || sourceMetadata.country != null || sourceMetadata.taken_at != null)) {
                    const exifValues = {
                        ...(sourceMetadata.latitude != null && { latitude: sourceMetadata.latitude }),
                        ...(sourceMetadata.longitude != null && { longitude: sourceMetadata.longitude }),
                        ...(sourceMetadata.city != null && { city: sourceMetadata.city }),
                        ...(sourceMetadata.country != null && { country: sourceMetadata.country }),
                        ...(sourceMetadata.taken_at != null && { taken_at: sourceMetadata.taken_at }),
                    };

                    await db
                        .insertInto('photo_metadata')
                        .values({
                            document_id: document.id,
                            ...exifValues,
                        })
                        .execute();
                }
            }
        }

        // Create processing jobs and enqueue to BullMQ
        const createdJobs: Array<{ id: string; job_type: string; status: string; target_id: string }> = [];

        // OCR job - create for all files (will be skipped by worker if not applicable)
        const ocrJob: NewProcessingJob = {
            user_id: userId,
            job_type: 'ocr',
            target_type: 'document',
            target_id: document.id,
            status: 'pending',
            priority: 0,
        };

        const createdOcrJob = await db
            .insertInto('processing_jobs')
            .values(ocrJob)
            .returning(['id', 'job_type', 'status', 'target_id'])
            .executeTakeFirstOrThrow();

        createdJobs.push(createdOcrJob);

        await addOcrJob(
            {
                documentId: document.id,
                sessionId,
                filePath: document.file_path,
            },
            createdOcrJob.id,
        );

        // Thumbnail job - only create if file type supports thumbnails
        if (canThumbnail) {
            const thumbnailJob: NewProcessingJob = {
                user_id: userId,
                job_type: 'thumbnail',
                target_type: 'document',
                target_id: document.id,
                status: 'pending',
                priority: 10, // Thumbnails have higher priority
            };

            const createdThumbnailJob = await db
                .insertInto('processing_jobs')
                .values(thumbnailJob)
                .returning(['id', 'job_type', 'status', 'target_id'])
                .executeTakeFirstOrThrow();

            createdJobs.push(createdThumbnailJob);

            await addThumbnailJob(
                {
                    documentId: document.id,
                    sessionId,
                    filePath: document.file_path,
                },
                createdThumbnailJob.id,
            );
        }

        return {
            document,
            jobs: createdJobs,
        };
    }

    /**
     * Replace a document's file (for image editor save-overwrite).
     * Deletes old file and thumbnails, stores new file, updates document record, queues OCR + thumbnail jobs.
     * Photo metadata is preserved (OCR worker won't overwrite when edited file has no EXIF).
     */
    async replaceDocumentFile(documentId: string, userId: string, file: UploadedFile): Promise<Document> {
        const document = await this.getDocument(documentId, userId);

        if (!document) {
            throw new Error('Document not found');
        }

        const userContext = await this.storageService.getUserStorageContext(userId);
        const mimeType = correctMimeType(file.filename, file.mimetype);
        const processed = await this.storageService.processAndStoreFile(file.buffer, file.filename, mimeType, userContext);
        const canThumbnail = canGenerateThumbnail(mimeType);

        // Delete old file and thumbnails from storage
        try {
            await this.storageService.deleteFile(document.file_path, userId);

            if (document.thumbnail_paths) {
                for (const path of Object.values(document.thumbnail_paths)) {
                    await this.storageService.deleteFile(path, userId);
                }
            }
        } catch (err) {
            console.error('Failed to delete old files from storage:', err);
        }

        // Delete existing processing jobs
        await db
            .deleteFrom('processing_jobs')
            .where('target_type', '=', 'document')
            .where('target_id', '=', documentId)
            .execute();

        // Update document record
        const updated = await db
            .updateTable('documents')
            .set({
                file_path: processed.storagePath,
                file_hash: processed.hash,
                size_bytes: file.buffer.length,
                width: processed.width,
                height: processed.height,
                thumbnail_blurhash: processed.blurhash,
                thumbnail_paths: null,
                ocr_status: 'pending',
                thumbnail_status: canThumbnail ? 'pending' : 'complete',
                updated_at: new Date(),
            })
            .where('id', '=', documentId)
            .where('user_id', '=', userId)
            .returningAll()
            .executeTakeFirstOrThrow();

        const sessionId = randomUUID();

        // Create and enqueue OCR job
        const ocrJob = await db
            .insertInto('processing_jobs')
            .values({
                user_id: userId,
                job_type: 'ocr',
                target_type: 'document',
                target_id: documentId,
                status: 'pending',
                priority: 0,
            })
            .returning(['id', 'job_type', 'status', 'target_id'])
            .executeTakeFirstOrThrow();

        await addOcrJob(
            {
                documentId,
                sessionId,
                filePath: updated.file_path,
            },
            ocrJob.id,
        );

        // Create and enqueue thumbnail job
        if (canThumbnail) {
            const thumbnailJob = await db
                .insertInto('processing_jobs')
                .values({
                    user_id: userId,
                    job_type: 'thumbnail',
                    target_type: 'document',
                    target_id: documentId,
                    status: 'pending',
                    priority: 10,
                })
                .returning(['id', 'job_type', 'status', 'target_id'])
                .executeTakeFirstOrThrow();

            await addThumbnailJob(
                {
                    documentId,
                    sessionId,
                    filePath: updated.file_path,
                },
                thumbnailJob.id,
            );
        }

        return updated;
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

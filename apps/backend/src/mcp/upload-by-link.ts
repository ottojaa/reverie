import { AppError } from '@reverie/shared';
import type { FastifyRequest } from 'fastify';
import { db } from '../db/kysely.js';
import { assertStorageRoom, storeDocuments, type AddedDocument } from '../tools/store-documents.js';
import { ToolError } from '../tools/types.js';
import { claimUploadLink, type UploadLink } from '../tools/upload-link.store.js';
import { assertTargetFolder, loadVisibility, type TargetFolder } from '../tools/visibility.js';
import { discardUploadedFiles, fileTooLargeError, receiveUploadedFile, type UploadedFile } from '../utils/upload-files.js';

/**
 * Receives the files sent to a one-time upload link (see upload_local_files). The link is the only
 * credential: it names the user and the folder, and the request can name nothing else.
 */

export interface LinkUploadResult {
    uploaded: number;
    folder: TargetFolder;
    documents: AddedDocument[];
    audit_id: string;
    undo: string;
}

const COUNT_LIMIT_CODES = new Set(['FST_PARTS_LIMIT', 'FST_FILES_LIMIT', 'FST_FIELDS_LIMIT']);

/** One answer for every way a link can fail, so it says nothing about links or folders. */
function toInvalidLinkError(): AppError {
    return new AppError(
        404,
        'upload_link_invalid',
        'This upload link is not valid: it has expired, was already used, or its folder is no longer available. Call upload_local_files again for a new one.',
    );
}

/** Use the link up. This happens before the body is read, so of two racing requests only one gets through. */
async function claimLink(request: FastifyRequest): Promise<UploadLink> {
    const secret = request.headers['x-upload-token'];

    if (typeof secret !== 'string' || !secret) throw toInvalidLinkError();

    const link = await claimUploadLink(secret);

    if (!link) throw toInvalidLinkError();

    return link;
}

/** The link's folder as it is now: it may have been locked or trashed since the link was made. */
async function fetchLinkFolder({ userId, folderId }: UploadLink): Promise<TargetFolder> {
    try {
        return await assertTargetFolder(db, await loadVisibility(userId), folderId);
    } catch (error) {
        if (error instanceof ToolError) throw toInvalidLinkError();

        throw error;
    }
}

/** Words the multipart plugin's own limit errors so that they say what the limit is. */
function toLimitError(error: unknown): unknown {
    const { code } = error as { code?: string };

    if (code === 'FST_REQ_FILE_TOO_LARGE') return fileTooLargeError();

    if (!code || !COUNT_LIMIT_CODES.has(code)) return error;

    return new AppError(413, 'TOO_MANY_FILES', 'Too many files or form parts in one request: send at most 50 files');
}

/** Spool every file part to disk, adding each to `files` so the caller can discard it. Other fields are ignored. */
async function receiveFiles(request: FastifyRequest, files: UploadedFile[]): Promise<void> {
    if (!request.isMultipart()) return;

    try {
        for await (const part of request.parts()) {
            if (part.type === 'file') files.push(await receiveUploadedFile(part));
        }
    } catch (error) {
        throw toLimitError(error);
    }
}

export async function uploadByLink(request: FastifyRequest): Promise<LinkUploadResult> {
    const link = await claimLink(request);
    const files: UploadedFile[] = [];

    try {
        await receiveFiles(request, files);

        if (files.length === 0) throw new AppError(400, 'NO_FILES', 'No files provided: send them as multipart/form-data file parts');

        // Checked once the files are in, so a folder locked during a long transfer is refused too.
        const folder = await fetchLinkFolder(link);
        await assertStorageRoom(link.userId, files);

        const auditInput = { folder_id: folder.id, filenames: files.map((file) => file.filename) };
        const { documents, auditId } = await storeDocuments({ userId: link.userId, folderId: folder.id, files, tool: 'upload_local_files', auditInput });

        return {
            uploaded: documents.length,
            folder,
            documents,
            audit_id: auditId,
            undo: 'To remove these documents (they go to the trash), call the undo_write tool with audit_id ' + auditId,
        };
    } finally {
        await discardUploadedFiles(files);
    }
}

import { NotFoundError } from '@reverie/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/kysely.js';
import type { Document } from '../db/schema.js';
import { loadFolderLocks, type FolderLocks } from './folder-locks.js';
import { getUploadService } from './upload.service.js';

/**
 * The one way a route reads a document by id: the document must exist (and not be trashed) and its
 * folder's lock must be open. Everything a document exposes (its file, thumbnails, OCR text, LLM
 * summary, jobs, edits) goes through here, so a route added later cannot forget the check.
 */
export async function loadOpenDocument(
    fastify: FastifyInstance,
    request: FastifyRequest,
    documentId: string,
): Promise<{ document: Document; locks: FolderLocks }> {
    const userId = request.user.id;
    const [document, locks] = await Promise.all([getUploadService().getDocument(documentId, userId), loadFolderLocks(fastify, request, userId)]);

    if (!document) throw new NotFoundError('Document', documentId);

    locks.assertOpen(document.folder_id);

    return { document, locks };
}

/**
 * The documents among `documentIds` that sit in a private folder whose lock is closed, as
 * document id -> folder id. Trashed documents count too: a trashed document is as private as its
 * folder. For callers that hold document ids but not the rows, such as job lookups.
 */
export async function fetchLockedDocuments(locks: FolderLocks, userId: string, documentIds: string[]): Promise<Map<string, string>> {
    if (documentIds.length === 0 || locks.lockedFolderIds.length === 0) return new Map();

    const rows = await db.selectFrom('documents').select(['id', 'folder_id']).where('user_id', '=', userId).where('id', 'in', documentIds).execute();

    return new Map(rows.flatMap((row) => (row.folder_id !== null && locks.isLocked(row.folder_id) ? [[row.id, row.folder_id] as [string, string]] : [])));
}

/** Throws FolderLockedError when any of these documents sits in a folder whose lock is closed. */
export async function assertDocumentsOpen(locks: FolderLocks, userId: string, documentIds: string[]): Promise<void> {
    const lockedFolderIds = (await fetchLockedDocuments(locks, userId, documentIds)).values();

    locks.assertAllOpen(lockedFolderIds);
}

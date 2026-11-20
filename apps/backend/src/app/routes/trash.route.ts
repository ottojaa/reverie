import {
    TrashListResponseSchema,
    TrashResultSchema,
    TrashSelectionSchema,
    type TrashDocument,
    type TrashFolder,
    type TrashListResponse,
    type TrashResult,
} from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/kysely';
import type { Document, Folder } from '../../db/schema';
import { loadFolderLocks, type FolderLocks } from '../../services/folder-locks';
import { getStorageService } from '../../services/storage.service';
import { getTrashService } from '../../services/trash.service';
import { resolveThumbnailUrls } from '../../utils/thumbnail-urls';

const storageService = getStorageService();

async function toTrashDocument(doc: Document, locks: FolderLocks, purgeAt: Date): Promise<TrashDocument> {
    return {
        id: doc.id,
        original_filename: doc.original_filename,
        mime_type: doc.mime_type,
        size_bytes: Number(doc.size_bytes),
        folder_id: doc.folder_id,
        is_private: locks.isPrivate(doc.folder_id),
        thumbnail_blurhash: doc.thumbnail_blurhash,
        thumbnail_urls: await resolveThumbnailUrls(storageService, doc.thumbnail_paths),
        deleted_at: doc.deleted_at!.toISOString(),
        purge_at: purgeAt.toISOString(),
    };
}

/** A trashed folder whose lock is closed is a bare row (no name or emoji): the user unlocks it to see and restore it. */
function toTrashFolder(folder: Folder, locks: FolderLocks, purgeAt: Date): TrashFolder {
    const locked = locks.isLocked(folder.id);

    return {
        id: folder.id,
        name: locked ? '' : folder.name,
        type: folder.type,
        emoji: locked ? null : folder.emoji,
        is_private: folder.is_private,
        locked,
        deleted_at: folder.deleted_at!.toISOString(),
        purge_at: purgeAt.toISOString(),
    };
}

/**
 * Restoring or purging a private item needs its lock open, like reading it does. Documents are
 * judged by their folder, trashed or not.
 */
async function assertSelectionOpen(locks: FolderLocks, userId: string, selection: { document_ids: string[]; folder_ids: string[] }): Promise<void> {
    const docs =
        selection.document_ids.length === 0
            ? []
            : await db.selectFrom('documents').select('folder_id').where('user_id', '=', userId).where('id', 'in', selection.document_ids).execute();

    locks.assertAllOpen([...docs.map((doc) => doc.folder_id), ...selection.folder_ids]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the retention job will purge an item: its deletion time plus the retention setting. */
function toPurgeAt(deletedAt: Date | null, retentionDays: number): Date {
    return new Date(deletedAt!.getTime() + retentionDays * DAY_MS);
}

export default async function (fastify: FastifyInstance) {
    const trashService = getTrashService();

    fastify.get<{ Reply: TrashListResponse }>(
        '/trash',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'List trashed documents and folders with their deletion and purge times',
                response: { 200: TrashListResponseSchema },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const { documents, folders, retentionDays } = await trashService.listTrash(userId);
            const locks = await loadFolderLocks(fastify, request, userId);
            // Items under a closed lock stay out, except a trashed private folder that is its own lock:
            // it lists as a bare row, because the tree has no row to unlock it from.
            const visibleFolders = folders.filter((folder) => !locks.isHidden(folder.id));
            const visibleDocuments = documents.filter((doc) => !locks.isLocked(doc.folder_id));

            return {
                retention_days: retentionDays,
                documents: await Promise.all(visibleDocuments.map((doc) => toTrashDocument(doc, locks, toPurgeAt(doc.deleted_at, retentionDays)))),
                folders: visibleFolders.map((folder) => toTrashFolder(folder, locks, toPurgeAt(folder.deleted_at, retentionDays))),
            };
        },
    );

    fastify.post<{ Body: { document_ids: string[]; folder_ids: string[] }; Reply: TrashResult }>(
        '/trash/restore',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Restore trashed documents and folders',
                body: TrashSelectionSchema,
                response: { 200: TrashResultSchema },
            },
        },
        async function (request) {
            const { document_ids, folder_ids } = request.body;
            await assertSelectionOpen(await loadFolderLocks(fastify, request, request.user.id), request.user.id, request.body);

            return trashService.restore(request.user.id, { documentIds: document_ids, folderIds: folder_ids });
        },
    );

    fastify.post<{ Body: { document_ids: string[]; folder_ids: string[] }; Reply: TrashResult }>(
        '/trash/purge',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Delete trashed documents and folders for good',
                body: TrashSelectionSchema,
                response: { 200: TrashResultSchema },
            },
        },
        async function (request) {
            const { document_ids, folder_ids } = request.body;
            const locks = await loadFolderLocks(fastify, request, request.user.id);
            await assertSelectionOpen(locks, request.user.id, request.body);

            return trashService.purge(request.user.id, { documentIds: document_ids, folderIds: folder_ids }, locks.lockedFolderIds);
        },
    );

    fastify.delete<{ Reply: TrashResult }>(
        '/trash',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Empty the trash: delete everything in it for good, except items under a closed folder lock',
                response: { 200: TrashResultSchema },
            },
        },
        async function (request) {
            const locks = await loadFolderLocks(fastify, request, request.user.id);

            return trashService.emptyTrash(request.user.id, locks.lockedFolderIds);
        },
    );
}

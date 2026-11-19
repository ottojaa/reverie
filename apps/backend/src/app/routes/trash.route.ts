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
import type { Document, Folder } from '../../db/schema';
import { getPrivateFolderIds, isDocumentEffectivelyPrivate } from '../../services/privacy';
import { getStorageService } from '../../services/storage.service';
import { getTrashService } from '../../services/trash.service';
import { isVaultLocked } from '../../services/vault';
import { resolveThumbnailUrls } from '../../utils/thumbnail-urls';

const storageService = getStorageService();

async function toTrashDocument(doc: Document, locked: boolean, purgeAt: Date): Promise<TrashDocument> {
    return {
        id: doc.id,
        original_filename: doc.original_filename,
        mime_type: doc.mime_type,
        size_bytes: Number(doc.size_bytes),
        folder_id: doc.folder_id,
        is_private: doc.is_private,
        locked,
        // Content stays withheld while the vault is locked, exactly as in /documents.
        thumbnail_blurhash: locked ? null : doc.thumbnail_blurhash,
        thumbnail_urls: locked ? null : await resolveThumbnailUrls(storageService, doc.thumbnail_paths),
        deleted_at: doc.deleted_at!.toISOString(),
        purge_at: purgeAt.toISOString(),
    };
}

function toTrashFolder(folder: Folder, locked: boolean, purgeAt: Date): TrashFolder {
    return {
        id: folder.id,
        name: folder.name,
        type: folder.type,
        emoji: folder.emoji,
        is_private: folder.is_private,
        locked,
        deleted_at: folder.deleted_at!.toISOString(),
        purge_at: purgeAt.toISOString(),
    };
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
            const vaultLocked = await isVaultLocked(fastify, request, userId);
            // Private ids are looked up regardless of trash, so a trashed item stays locked.
            const privateFolderIds = vaultLocked ? await getPrivateFolderIds(userId) : [];

            return {
                retention_days: retentionDays,
                documents: await Promise.all(
                    documents.map((doc) =>
                        toTrashDocument(doc, vaultLocked && isDocumentEffectivelyPrivate(doc, privateFolderIds), toPurgeAt(doc.deleted_at, retentionDays)),
                    ),
                ),
                folders: folders.map((folder) =>
                    toTrashFolder(folder, vaultLocked && privateFolderIds.includes(folder.id), toPurgeAt(folder.deleted_at, retentionDays)),
                ),
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

            return trashService.purge(request.user.id, { documentIds: document_ids, folderIds: folder_ids });
        },
    );

    fastify.delete<{ Reply: TrashResult }>(
        '/trash',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Empty the trash: delete everything in it for good',
                response: { 200: TrashResultSchema },
            },
        },
        async function (request) {
            return trashService.emptyTrash(request.user.id);
        },
    );
}

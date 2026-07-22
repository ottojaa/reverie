import {
    CreateFolderRequestSchema,
    FolderSchema,
    FolderWithChildrenSchema,
    ReorderFoldersRequestSchema,
    UpdateFolderRequestSchema,
    UuidSchema,
    type CreateFolderRequest,
    type Folder,
    type FolderWithChildren,
    type ReorderFoldersRequest,
    type UpdateFolderRequest,
} from '@reverie/shared';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getFolderService } from '../../services/folder.service';
import { getPrivateFolderIds } from '../../services/privacy';
import { isVaultLocked } from '../../services/vault';

const folderService = getFolderService();

/**
 * The set of folder ids that are locked (content withheld) for this request: the
 * effectively-private folders when the vault is locked, empty otherwise. Folders always
 * appear in listings — this drives the per-folder `locked` flag, not their visibility.
 */
async function resolveLockedFolderIds(fastify: FastifyInstance, request: FastifyRequest, userId: string): Promise<Set<string>> {
    if (!(await isVaultLocked(fastify, request, userId))) return new Set();

    return new Set(await getPrivateFolderIds(userId));
}

export default async function (fastify: FastifyInstance) {
    // List root folders (requires authentication)
    fastify.get<{ Reply: Folder[] }>(
        '/folders',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'List root-level folders',
                response: {
                    200: z.array(FolderSchema),
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const lockedIds = await resolveLockedFolderIds(fastify, request, userId);
            const folders = await folderService.listChildren(null, userId);

            return folders.map((folder) => serializeFolder(folder, lockedIds.has(folder.id)));
        },
    );

    // Get full folder tree (requires authentication)
    fastify.get<{ Reply: FolderWithChildren[] }>(
        '/folders/tree',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get folder tree with nested children and document counts',
                response: {
                    200: z.array(FolderWithChildrenSchema),
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const lockedIds = await resolveLockedFolderIds(fastify, request, userId);
            const tree = await folderService.getFolderTree(userId);

            return tree.map((node) => serializeFolderWithChildren(node, lockedIds));
        },
    );

    // Reorder folders (requires authentication)
    fastify.put<{
        Body: ReorderFoldersRequest;
    }>(
        '/folders/reorder',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Batch update folder sort order',
                body: ReorderFoldersRequestSchema,
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            await folderService.reorderFolders(userId, request.body.updates);
            reply.status(204).send();
        },
    );

    // Get folder by ID (requires authentication)
    fastify.get<{
        Params: { id: string };
        Reply: Folder;
    }>(
        '/folders/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get folder by ID',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: FolderSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const folder = await folderService.getFolder(request.params.id, userId);

            if (!folder) {
                return reply.notFound('Folder not found');
            }

            // The folder is always visible (title only); mark it locked while the vault is.
            const lockedIds = await resolveLockedFolderIds(fastify, request, userId);

            return serializeFolder(folder, lockedIds.has(folder.id));
        },
    );

    // List folder children (requires authentication)
    fastify.get<{
        Params: { id: string };
        Reply: Folder[];
    }>(
        '/folders/:id/children',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'List child folders',
                params: z.object({ id: UuidSchema }),
                response: {
                    200: z.array(FolderSchema),
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const lockedIds = await resolveLockedFolderIds(fastify, request, userId);
            const children = await folderService.listChildren(request.params.id, userId);

            return children.map((folder) => serializeFolder(folder, lockedIds.has(folder.id)));
        },
    );

    // Create folder (requires authentication)
    fastify.post<{
        Body: CreateFolderRequest;
        Reply: Folder;
    }>(
        '/folders',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Create a new folder',
                body: CreateFolderRequestSchema,
                response: {
                    201: FolderSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { name, parent_id, description, emoji, type } = request.body;
            const folder = await folderService.createFolder(userId, name, parent_id, description, emoji, type);
            reply.status(201);

            return serializeFolder(folder);
        },
    );

    // Update folder (requires authentication)
    fastify.patch<{
        Params: { id: string };
        Body: UpdateFolderRequest;
        Reply: Folder;
    }>(
        '/folders/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Update a folder',
                params: z.object({ id: UuidSchema }),
                body: UpdateFolderRequestSchema,
                response: {
                    200: FolderSchema,
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;

            // Removing privacy while the vault is locked would expose content without the
            // password — refuse it for a currently-locked folder.
            if (request.body.is_private === false) {
                const lockedIds = await resolveLockedFolderIds(fastify, request, userId);

                if (lockedIds.has(request.params.id)) {
                    return reply.forbidden('Unlock to change privacy of a locked folder');
                }
            }

            const folder = await folderService.updateFolder(request.params.id, userId, request.body);

            return serializeFolder(folder);
        },
    );

    // Delete folder (requires authentication)
    fastify.delete<{
        Params: { id: string };
    }>(
        '/folders/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Delete a folder',
                params: z.object({ id: UuidSchema }),
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            await folderService.deleteFolder(request.params.id, userId);
            reply.status(204).send();
        },
    );
}

function serializeFolder(folder: import('../../db/schema').Folder, locked = false): Folder {
    return {
        id: folder.id,
        parent_id: folder.parent_id,
        name: folder.name,
        path: folder.path,
        description: folder.description,
        emoji: folder.emoji,
        sort_order: folder.sort_order,
        type: folder.type,
        is_private: folder.is_private,
        locked,
        created_at: folder.created_at.toISOString(),
        updated_at: folder.updated_at.toISOString(),
    };
}

function serializeFolderWithChildren(
    node: import('../../db/schema').Folder & { children: unknown[]; document_count: number },
    lockedIds: Set<string>,
): FolderWithChildren {
    return {
        ...serializeFolder(node, lockedIds.has(node.id)),
        children: (node.children as Array<import('../../db/schema').Folder & { children: unknown[]; document_count: number }>).map((child) =>
            serializeFolderWithChildren(child, lockedIds),
        ),
        document_count: node.document_count,
    };
}

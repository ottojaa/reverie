import {
    CreateFolderRequestSchema,
    FolderSchema,
    FolderWithChildrenSchema,
    ReorderSectionsRequestSchema,
    UpdateFolderRequestSchema,
    UuidSchema,
    type CreateFolderRequest,
    type Folder,
    type FolderWithChildren,
    type ReorderSectionsRequest,
    type UpdateFolderRequest,
} from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getFolderService } from '../../services/folder.service';

const folderService = getFolderService();

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
            const folders = await folderService.listChildren(null, userId);
            return folders.map(serializeFolder);
        },
    );

    // Get full section tree (requires authentication)
    fastify.get<{ Reply: FolderWithChildren[] }>(
        '/folders/tree',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get section tree with nested children and document counts',
                response: {
                    200: z.array(FolderWithChildrenSchema),
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const tree = await folderService.getSectionTree(userId);
            return tree.map((node) => serializeFolderWithChildren(node));
        },
    );

    // Reorder sections (requires authentication)
    fastify.put<{
        Body: ReorderSectionsRequest;
    }>(
        '/folders/reorder',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Batch update section sort order',
                body: ReorderSectionsRequestSchema,
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            await folderService.reorderSections(userId, request.body.updates);
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
            return serializeFolder(folder);
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
            const children = await folderService.listChildren(request.params.id, userId);
            return children.map(serializeFolder);
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
            const { name, parent_id, description, emoji } = request.body;
            const folder = await folderService.createFolder(userId, name, parent_id, description, emoji);
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
        async function (request) {
            const userId = request.user.id;
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

function serializeFolder(folder: import('../../db/schema').Folder): Folder {
    return {
        id: folder.id,
        parent_id: folder.parent_id,
        name: folder.name,
        path: folder.path,
        description: folder.description,
        emoji: folder.emoji,
        sort_order: folder.sort_order,
        created_at: folder.created_at.toISOString(),
        updated_at: folder.updated_at.toISOString(),
    };
}

function serializeFolderWithChildren(
    node: import('../../db/schema').Folder & { children: unknown[]; document_count: number },
): FolderWithChildren {
    return {
        ...serializeFolder(node),
        children: (node.children as Array<import('../../db/schema').Folder & { children: unknown[]; document_count: number }>).map(
            (child) => serializeFolderWithChildren(child),
        ),
        document_count: node.document_count,
    };
}

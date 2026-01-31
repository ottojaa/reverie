import {
    CreateFolderRequestSchema,
    FolderSchema,
    UpdateFolderRequestSchema,
    UuidSchema,
    type CreateFolderRequest,
    type Folder,
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
            const { name, parent_id, description } = request.body;
            const folder = await folderService.createFolder(userId, name, parent_id, description);
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
        created_at: folder.created_at.toISOString(),
        updated_at: folder.updated_at.toISOString(),
    };
}

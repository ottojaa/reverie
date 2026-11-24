import {
    CreateFolderRequestSchema,
    FolderSchema,
    FolderWithChildrenSchema,
    ReorderFoldersRequestSchema,
    UpdateFolderRequestSchema,
    UuidSchema,
    type CreateFolderRequest,
    type Folder,
    type FolderCover,
    type FolderWithChildren,
    type ReorderFoldersRequest,
    type UpdateFolderRequest,
} from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Folder as DbFolder } from '../../db/schema';
import { loadFolderCovers } from '../../services/document-summary';
import { loadFolderLocks, type FolderLocks } from '../../services/folder-locks';
import { getFolderService } from '../../services/folder.service';

const folderService = getFolderService();

type TreeNode = DbFolder & { children: unknown[]; document_count: number };

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
            const locks = await loadFolderLocks(fastify, request, userId);
            const folders = await folderService.listChildren(null, userId);

            return folders.map((folder) => serializeFolder(folder, locks));
        },
    );

    // Get full folder tree (requires authentication)
    fastify.get<{ Reply: FolderWithChildren[] }>(
        '/folders/tree',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get folder tree with nested children, document counts and folder covers',
                response: {
                    200: z.array(FolderWithChildrenSchema),
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const locks = await loadFolderLocks(fastify, request, userId);
            const tree = await folderService.getFolderTree(userId);
            const covers = await loadFolderCovers(userId, collectCoverFolderIds(tree, locks));

            return tree.map((node) => serializeFolderWithChildren(node, locks, covers));
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

            // A locked folder's own row stays readable (title only, `locked: true`); one hidden by its
            // locked collection is refused like its contents.
            const locks = await loadFolderLocks(fastify, request, userId);

            if (locks.isHidden(folder.id)) locks.assertOpen(folder.id);

            return serializeFolder(folder, locks);
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
            const locks = await loadFolderLocks(fastify, request, userId);
            locks.assertOpen(request.params.id);
            const children = await folderService.listChildren(request.params.id, userId);

            return children.map((folder) => serializeFolder(folder, locks));
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
            const locks = await loadFolderLocks(fastify, request, userId);

            // Creating under a locked collection would reveal which names it already holds.
            locks.assertOpen(parent_id ?? null);

            const folder = await folderService.createFolder(userId, name, parent_id, description, emoji, type);
            reply.status(201);

            return serializeFolder(folder, locks);
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

            // Moving a folder out of its lock, or making it public, would expose what the lock hides, so
            // that lock must be open. Making a folder private exposes nothing and needs no unlock.
            const before = await loadFolderLocks(fastify, request, userId);

            if (request.body.is_private === false || request.body.parent_id !== undefined) before.assertOpen(request.params.id);

            const folder = await folderService.updateFolder(request.params.id, userId, request.body);

            return serializeFolder(folder, await loadFolderLocks(fastify, request, userId));
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
                description: 'Move a folder to the trash (its documents go with it)',
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

function serializeFolder(folder: DbFolder, locks: FolderLocks): Folder {
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
        locked: locks.isLocked(folder.id),
        created_at: folder.created_at.toISOString(),
        updated_at: folder.updated_at.toISOString(),
    };
}

/** A locked collection shows no folders; a locked folder shows no documents (its count reads 0) and no cover. */
function serializeFolderWithChildren(node: TreeNode, locks: FolderLocks, covers: Map<string, FolderCover>): FolderWithChildren {
    const locked = locks.isLocked(node.id);

    return {
        ...serializeFolder(node, locks),
        children: locked ? [] : (node.children as TreeNode[]).map((child) => serializeFolderWithChildren(child, locks, covers)),
        document_count: locked ? 0 : node.document_count,
        cover: covers.get(node.id) ?? null,
    };
}

/**
 * The folders whose cover is built: not collections, and nothing private. A closed lock hides its
 * subtree (never walked); an open one still gets no cover, because the tree is a broad listing and
 * private documents (ids, filenames) stay out of every listing, open or not: they are only
 * reachable by asking for their folder.
 */
function collectCoverFolderIds(nodes: TreeNode[], locks: FolderLocks): string[] {
    return nodes.flatMap((node) => {
        if (locks.isLocked(node.id)) return [];

        const own = node.type === 'folder' && !locks.isPrivate(node.id) ? [node.id] : [];

        return [...own, ...collectCoverFolderIds(node.children as TreeNode[], locks)];
    });
}

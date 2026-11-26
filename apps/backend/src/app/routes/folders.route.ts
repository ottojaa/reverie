import {
    CreateFolderRequestSchema,
    FolderSchema,
    FolderWithChildrenSchema,
    NotFoundError,
    ReorderFoldersRequestSchema,
    UpdateFolderRequestSchema,
    UuidSchema,
    type CreateFolderRequest,
    type Folder,
    type FolderWithChildren,
    type ReorderFoldersRequest,
    type UpdateFolderRequest,
} from '@reverie/shared';
import { FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Folder as DbFolder } from '../../db/schema';
import { loadFolderLocks, type FolderLocks } from '../../services/folder-locks';
import { serializeFolder } from '../../services/folder-serializer';
import { loadFolderTree } from '../../services/folders/load';
import { EMPTY_ROLLUP, loadFolderRollups, type FolderRollup } from '../../services/folders/rollup';
import type { FolderTree } from '../../services/folders/snapshot';
import { inFolderTransaction } from '../../services/folders/transaction';
import { trashFolder } from '../../services/folders/trash';
import { createFolder, reorderFolders, toSharedParentId, updateFolder } from '../../services/folders/writes';

/**
 * Throws unless the open locks allow the change. Moving a folder out of its lock, or making it public, would
 * expose what the lock hides, so that lock must be open, and so must the lock of where it goes. A folder inside a
 * locked one takes no changes at all. No change may open a closed lock at or beneath the folder, so making a
 * folder private needs no unlock unless it would do that.
 */
function assertMayChange(tree: FolderTree<DbFolder>, locks: FolderLocks, id: string, change: UpdateFolderRequest): void {
    const { is_private, parent_id } = change;

    if (locks.isHidden(id) || is_private === false || parent_id !== undefined) locks.assertOpen(id);

    locks.assertOpen(parent_id ?? null);

    const folder = tree.folder(id);
    const parentAfter = parent_id === undefined ? (folder?.parent_id ?? null) : parent_id;
    // The lock above its new place covers the folder afterwards; without one, it may be a lock of its own.
    const lockAfter = locks.lockIdOf(parentAfter) ?? ((is_private ?? folder?.is_private) ? id : null);
    const subtreeIds = tree.subtree(id, { trashed: true }).map((below) => below.id);

    locks.assertNoneOpenedBy(lockAfter, subtreeIds);
}

export default async function (fastify: FastifyInstance) {
    /** The request user's folders, and the lock state of the same moment. */
    async function loadTreeAndLocks(request: FastifyRequest): Promise<{ tree: FolderTree<DbFolder>; locks: FolderLocks }> {
        const tree = await loadFolderTree(request.user.id);

        return { tree, locks: await loadFolderLocks(fastify, request, request.user.id, tree) };
    }

    // List root folders (requires authentication)
    fastify.get<{ Reply: Folder[] }>(
        '/folders',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'List the top-level folders',
                response: {
                    200: z.array(FolderSchema),
                },
            },
        },
        async function (request) {
            const { tree, locks } = await loadTreeAndLocks(request);

            return tree.children(null).map((folder) => serializeFolder(folder, locks));
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
            const { tree, locks } = await loadTreeAndLocks(request);
            const roots = tree.children(null);
            const rollups = await loadFolderRollups(
                request.user.id,
                tree,
                roots.map((folder) => folder.id),
                locks,
            );

            return roots.map((folder) => toTreeNode(folder, { tree, locks, rollups }));
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
            const { tree, locks } = await loadTreeAndLocks(request);
            const { updates } = request.body;

            // Reordering what a locked folder holds needs that folder open.
            locks.assertOpen(
                toSharedParentId(
                    tree,
                    updates.map((update) => update.id),
                ),
            );

            await reorderFolders(request.user.id, updates);
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
            const { tree, locks } = await loadTreeAndLocks(request);
            const folder = tree.folder(request.params.id);

            // Thrown, not replied: the error handler turns a sensible reply into a 500.
            if (!folder || folder.deleted_at !== null) throw new NotFoundError('Folder', request.params.id);

            // A locked folder's own row stays readable (title only, `locked: true`); one hidden by a
            // locked folder above it is refused like its contents.
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
            const { tree, locks } = await loadTreeAndLocks(request);
            locks.assertOpen(request.params.id);

            return tree.children(request.params.id).map((folder) => serializeFolder(folder, locks));
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
            const locks = await loadFolderLocks(fastify, request, userId);

            // Creating under a locked folder would reveal which names it already holds.
            locks.assertOpen(parent_id ?? null);

            const folder = await createFolder(userId, { name, parentId: parent_id, description, emoji });
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
            const { id } = request.params;

            // Checked and written under the folder lock, so no other change to the tree comes in between.
            const folder = await inFolderTransaction(userId, async (trx) => {
                const tree = await loadFolderTree(userId, trx);

                assertMayChange(tree, await loadFolderLocks(fastify, request, userId, tree, trx), id, request.body);

                return updateFolder(userId, id, request.body, trx);
            });

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
                description: 'Move a folder to the trash, with everything in it',
                params: z.object({ id: UuidSchema }),
                response: {
                    204: z.null(),
                },
            },
        },
        async function (request, reply) {
            const { id } = request.params;
            const locks = await loadFolderLocks(fastify, request, request.user.id);

            if (locks.isHidden(id)) locks.assertOpen(id);

            await trashFolder(request.user.id, id);
            reply.status(204).send();
        },
    );
}

interface TreeContext {
    tree: FolderTree<DbFolder>;
    locks: FolderLocks;
    rollups: Map<string, FolderRollup>;
}

/** A locked folder shows nothing it holds: no folders, no counts, no cover. */
function toTreeNode(folder: DbFolder, context: TreeContext): FolderWithChildren {
    const children = context.locks.isLocked(folder.id) ? [] : context.tree.children(folder.id);

    return {
        ...serializeFolder(folder, context.locks),
        ...(context.rollups.get(folder.id) ?? EMPTY_ROLLUP),
        children: children.map((child) => toTreeNode(child, context)),
    };
}

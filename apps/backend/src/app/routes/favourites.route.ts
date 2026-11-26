import {
    FavouriteListResponseSchema,
    FavouriteTypeSchema,
    NotFoundError,
    SetFavouriteRequestSchema,
    UuidSchema,
    type FavouriteListResponse,
    type FavouriteType,
    type SetFavouriteRequest,
} from '@reverie/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadOpenDocument } from '../../services/document-access';
import { addFavourite, fetchLockFolderId, listFavourites, removeFavourite } from '../../services/favourites';
import { loadFolderLocks } from '../../services/folder-locks';
import { findLiveFolder } from '../../services/folders/load';

export default async function (fastify: FastifyInstance) {
    // GET /favourites - every starred document and folder (requires authentication)
    fastify.get(
        '/favourites',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'List favourites, newest-starred first. Private items are anonymous, locked or not.',
                tags: ['Favourites'],
                response: { 200: FavouriteListResponseSchema },
            },
        },
        async function (request): Promise<FavouriteListResponse> {
            const userId = request.user.id;

            return { items: await listFavourites(userId, await loadFolderLocks(fastify, request, userId)) };
        },
    );

    // PUT /favourites/:type/:id - star or unstar one item (requires authentication)
    fastify.put<{ Params: { type: FavouriteType; id: string }; Body: SetFavouriteRequest }>(
        '/favourites/:type/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Star or unstar a document or folder',
                tags: ['Favourites'],
                params: z.object({ type: FavouriteTypeSchema, id: UuidSchema }),
                body: SetFavouriteRequestSchema,
                response: { 204: z.null() },
            },
        },
        async function (request, reply) {
            const { type, id } = request.params;

            if (request.body.is_favourite) {
                await star(request, type, id);
            } else {
                await unstar(request, type, id);
            }

            reply.status(204).send();
        },
    );

    /** Missing, trashed and another user's items are all 404; an item behind a closed lock is 403. */
    async function star(request: FastifyRequest, type: FavouriteType, id: string): Promise<void> {
        const userId = request.user.id;

        if (type === 'document') {
            await loadOpenDocument(fastify, request, id);
        } else {
            if (!(await findLiveFolder(userId, id))) throw new NotFoundError('Folder', id);

            (await loadFolderLocks(fastify, request, userId)).assertOpen(id);
        }

        await addFavourite(userId, type, id);
    }

    /** Succeeds whether or not there is a star to remove; only a closed lock refuses it. */
    async function unstar(request: FastifyRequest, type: FavouriteType, id: string): Promise<void> {
        const userId = request.user.id;
        const [lockFolderId, locks] = await Promise.all([fetchLockFolderId(userId, type, id), loadFolderLocks(fastify, request, userId)]);
        locks.assertOpen(lockFolderId);

        await removeFavourite(userId, type, id);
    }
}

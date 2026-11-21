import {
    DismissDuplicatesRequestSchema,
    DismissDuplicatesResponseSchema,
    DuplicatesQuerySchema,
    DuplicatesResponseSchema,
    TrashOthersRequestSchema,
    TrashOthersResponseSchema,
    type DismissDuplicatesRequest,
    type DuplicatesQuery,
    type TrashOthersRequest,
} from '@reverie/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env';
import { dismissGroup, loadDuplicateGroups, resolveScope, trashOthers } from '../../duplicates/duplicates.service';
import { loadFolderLocks } from '../../services/folder-locks';

export default async function (fastify: FastifyInstance) {
    async function loadScope(request: FastifyRequest, folderId: string | undefined) {
        return resolveScope(await loadFolderLocks(fastify, request, request.user.id), request.user.id, folderId);
    }

    fastify.get<{ Querystring: DuplicatesQuery }>(
        '/duplicates',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Groups of images that are the same picture or nearly so',
                tags: ['duplicates'],
                querystring: DuplicatesQuerySchema,
                response: { 200: DuplicatesResponseSchema },
            },
        },
        async function (request) {
            const groups = await loadDuplicateGroups(await loadScope(request, request.query.folder_id));

            return { groups, threshold: env.DUPLICATE_MIN_SIMILARITY };
        },
    );

    fastify.post<{ Body: TrashOthersRequest }>(
        '/duplicates/trash-others',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Move every image but the chosen one of each group to the Trash',
                tags: ['duplicates'],
                body: TrashOthersRequestSchema,
                response: { 200: TrashOthersResponseSchema },
            },
        },
        async function (request) {
            return trashOthers(await loadScope(request, request.body.folder_id), request.body);
        },
    );

    fastify.post<{ Body: DismissDuplicatesRequest }>(
        '/duplicates/dismiss',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Mark a group as not duplicates, for good',
                tags: ['duplicates'],
                body: DismissDuplicatesRequestSchema,
                response: { 200: DismissDuplicatesResponseSchema },
            },
        },
        async function (request) {
            await dismissGroup(await loadScope(request, request.body.folder_id), request.body.group_id);

            return { dismissed: true };
        },
    );
}

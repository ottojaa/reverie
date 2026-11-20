import { OrganizeExecuteRequestSchema, OrganizeExecuteResponseSchema, type OrganizeExecuteRequest } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { assertDocumentsOpen } from '../../services/document-access';
import { loadFolderLocks } from '../../services/folder-locks';
import { executeOrganize } from '../../services/organize.service';

export default async function (fastify: FastifyInstance) {
    /**
     * POST /organize/execute
     *
     * Execute a confirmed organization proposal.
     * Creates new folders as needed and moves documents.
     */
    fastify.post<{ Body: OrganizeExecuteRequest }>(
        '/organize/execute',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Execute a confirmed document organization plan',
                body: OrganizeExecuteRequestSchema,
                response: {
                    200: OrganizeExecuteResponseSchema,
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const { operations } = request.body;

            // Moves take documents out of their folders, so every source folder's lock must be open.
            const documentIds = operations.flatMap((op) => (op.type === 'move' || op.type === 'create_and_move' ? op.document_ids : []));
            await assertDocumentsOpen(await loadFolderLocks(fastify, request, userId), userId, documentIds);

            return executeOrganize({ operations, userId });
        },
    );
}

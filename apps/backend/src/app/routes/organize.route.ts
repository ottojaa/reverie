import { OrganizeExecuteRequestSchema, OrganizeExecuteResponseSchema, type OrganizeExecuteRequest } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
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

            return executeOrganize({ operations, userId });
        },
    );
}

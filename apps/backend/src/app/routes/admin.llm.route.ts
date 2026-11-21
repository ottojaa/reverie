import { TestLlmConnectionRequestSchema, TestLlmConnectionResponseSchema, type TestLlmConnectionRequest } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { testLlmConnection } from '../../llm/connection-test.js';

export default async function (fastify: FastifyInstance) {
    fastify.post(
        '/admin/llm/test',
        {
            preHandler: [fastify.authenticate, fastify.authenticateAdmin],
            schema: {
                description: 'Send a tiny request to an AI provider as typed (not as saved) and report its reply or the error (admin only)',
                tags: ['Admin'],
                body: TestLlmConnectionRequestSchema,
                response: { 200: TestLlmConnectionResponseSchema },
            },
        },
        async (request) => testLlmConnection(request.body as TestLlmConnectionRequest),
    );
}

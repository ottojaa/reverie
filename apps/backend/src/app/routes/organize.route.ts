import {
    OrganizeChatRequestSchema,
    OrganizeExecuteRequestSchema,
    OrganizeExecuteResponseSchema,
    type OrganizeChatRequest,
    type OrganizeExecuteRequest,
} from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { executeOrganize, runOrganizeChat } from '../../services/organize.service';

export default async function (fastify: FastifyInstance) {
    /**
     * POST /organize/chat
     *
     * SSE streaming endpoint for AI-driven document organization.
     * Accepts a user message and optional previous_response_id for multi-turn.
     * Streams SSE events: status | delta | proposal | done | error
     */
    fastify.post<{ Body: OrganizeChatRequest }>(
        '/organize/chat',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'AI document organization chat (SSE streaming)',
                body: OrganizeChatRequestSchema,
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { message, response_id } = request.body;

            // reply.raw.writeHead bypasses Fastify's CORS plugin, so we add headers manually.
            const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
            const requestOrigin = request.headers.origin ?? '';
            const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (allowedOrigins[0] ?? '');

            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
                'Access-Control-Allow-Origin': corsOrigin,
                'Access-Control-Allow-Credentials': 'true',
            });

            try {
                await runOrganizeChat({
                    message,
                    responseId: response_id,
                    userId,
                    res: reply.raw,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'An unexpected error occurred';
                reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
            } finally {
                reply.raw.end();
            }
        },
    );

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

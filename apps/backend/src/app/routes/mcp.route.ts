import { createHash } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { createMcpServer } from '../../mcp/mcp-server.js';
import { toPublicBaseUrl } from '../../mcp/public-base-url.js';
import { readBearerToken } from '../plugins/api-token-auth.js';

const JSON_RPC_INTERNAL_ERROR = { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null };
const JSON_RPC_METHOD_NOT_ALLOWED = { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless, POST to it' }, id: null };

/**
 * Per client, not per IP: behind the reverse proxy every caller shares one address. The key is
 * made before the token is verified, so it limits a real client's call rate, not a flood of
 * made-up tokens (each of which costs one indexed lookup).
 */
function toRateLimitKey(request: FastifyRequest): string {
    const secret = readBearerToken(request);

    return secret ? 'mcp:' + createHash('sha256').update(secret).digest('hex') : 'mcp-anonymous:' + request.ip;
}

/**
 * MCP over Streamable HTTP, stateless: every POST gets its own server and transport for the token's
 * user and answers with plain JSON. The tools keep no per-connection state (selections live in
 * Redis, keyed by user), so there is no session to track, lose on a restart or pin to a replica.
 */
export default async function (fastify: FastifyInstance) {
    fastify.post(
        '/mcp',
        {
            preHandler: [fastify.authenticateApiToken],
            config: { rateLimit: { max: 300, timeWindow: '1 minute', keyGenerator: toRateLimitKey } },
            schema: { hide: true },
        },
        async (request, reply) => {
            const publicBaseUrl = toPublicBaseUrl(request, env.API_PUBLIC_URL);
            const server = createMcpServer({ user: { id: request.user.id }, publicBaseUrl });
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

            reply.hijack();
            reply.raw.on('close', () => {
                void transport.close();
                void server.close();
            });

            try {
                await server.connect(transport);
                await transport.handleRequest(request.raw, reply.raw, request.body);
            } catch (error) {
                request.log.error({ err: error }, 'MCP request failed');

                if (reply.raw.headersSent) return;

                reply.raw.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify(JSON_RPC_INTERNAL_ERROR));
            }
        },
    );

    // A stateless server has no stream to open (GET) and no session to end (DELETE).
    for (const method of ['GET', 'DELETE'] as const) {
        fastify.route({
            method,
            url: '/mcp',
            schema: { hide: true },
            handler: async (_request, reply) => reply.status(405).header('Allow', 'POST').send(JSON_RPC_METHOD_NOT_ALLOWED),
        });
    }
}

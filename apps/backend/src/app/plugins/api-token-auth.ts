import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyApiToken } from '../../services/api-token.service.js';

/* eslint-disable no-unused-vars */
declare module 'fastify' {
    interface FastifyInstance {
        /**
         * preHandler for routes meant for tools holding an API token (the MCP endpoint). Sets
         * `request.user` from the token. A web login JWT does not pass here, and an API token does
         * not pass `authenticate`, so neither credential reaches the other's routes.
         */
        authenticateApiToken: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

const BEARER = /^Bearer\s+(\S+)$/i;

export function readBearerToken(request: FastifyRequest): string | null {
    return BEARER.exec(request.headers.authorization ?? '')?.[1] ?? null;
}

export default fp(async function (fastify) {
    fastify.decorate('authenticateApiToken', async function (request: FastifyRequest, reply: FastifyReply) {
        const secret = readBearerToken(request);
        const verified = secret ? await verifyApiToken(secret) : null;

        if (!verified) {
            return reply.status(401).header('WWW-Authenticate', 'Bearer').send({
                error: 'token_invalid',
                message: 'Missing, invalid or revoked API token',
            });
        }

        request.user = verified.user;
    });
});

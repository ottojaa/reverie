import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../../config/env.js';
import { readBearerToken } from './api-token-auth.js';
import { isLoginPayload, type JwtPayload } from './auth.js';

/**
 * For a route whose own limit counts per client address, signed in or not. A route's `config.rateLimit`
 * inherits the per-user key below unless it names a `keyGenerator` itself.
 */
export function toAddressKey(request: FastifyRequest): string {
    return request.ip;
}

/**
 * One count per signed-in user, otherwise per client address (behind the reverse proxy, one address for
 * everyone). The limiter runs before `authenticate`, so the login token is verified here: only a token
 * this server signed gets a user's count, anything else counts against its address.
 */
function toUserKey(request: FastifyRequest): string {
    const token = readBearerToken(request);

    if (!token) return toAddressKey(request);

    try {
        const decoded = request.server.jwt.verify<JwtPayload>(token);

        return isLoginPayload(decoded) ? 'user:' + decoded.sub : toAddressKey(request);
    } catch {
        return toAddressKey(request);
    }
}

/**
 * Global rate limiting, per signed-in user. A route with its own `config.rateLimit` keeps a count apart
 * from this one.
 *
 * Skipped in development: not registering the plugin also makes the per-route
 * config.rateLimit overrides inert, so local dev has no rate limiting at all.
 */
export default fp(async function (fastify: FastifyInstance) {
    if (env.NODE_ENV === 'development') {
        fastify.log.info('Rate limiting disabled in development');

        return;
    }

    await fastify.register(fastifyRateLimit, {
        max: 2500,
        timeWindow: '15 minutes',
        keyGenerator: toUserKey,
    });
});

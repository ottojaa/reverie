import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../../config/env.js';

/**
 * Global rate limiting. Per-route overrides via config.rateLimit on auth routes.
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
    });
});

import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Global rate limiting. Per-route overrides via config.rateLimit on auth routes.
 */
export default fp(async function (fastify: FastifyInstance) {
    await fastify.register(fastifyRateLimit, {
        max: 2500,
        timeWindow: '15 minutes',
    });
});

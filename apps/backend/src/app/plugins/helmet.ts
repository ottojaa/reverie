import fastifyHelmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
 */
export default fp(async function (fastify: FastifyInstance) {
    await fastify.register(fastifyHelmet, {
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: false,
    });
});

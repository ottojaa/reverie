import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../../config/env.js';

/**
 * CORS plugin. Handles preflight OPTIONS and adds CORS headers to responses.
 * Required for browser clients (e.g. web app on different origin).
 */
export default fp(async function (fastify: FastifyInstance) {
    const origins = env.CORS_ORIGIN.split(',').map((o) => o.trim());

    await fastify.register(cors, {
        origin: origins.length === 1 && origins[0] ? origins[0] : origins,
        credentials: true, // allow cookies (refresh_token)
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    });
});

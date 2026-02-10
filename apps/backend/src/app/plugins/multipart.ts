import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export default fp(async function (fastify: FastifyInstance) {
    fastify.register(multipart, {
        limits: {
            fileSize: 2 * 1024 * 1024 * 1024, // 300MB max file size
            files: 50, // Max 50 files per request
        },
    });
});

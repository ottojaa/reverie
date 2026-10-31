import multipart from '@fastify/multipart';
import { MAX_UPLOAD_FILE_SIZE_BYTES } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export default fp(async function (fastify: FastifyInstance) {
    fastify.register(multipart, {
        limits: {
            fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
            files: 50, // Max 50 files per request
        },
    });
});

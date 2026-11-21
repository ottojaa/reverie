import { EmbeddingStatusResponseSchema } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/kysely.js';
import { loadEmbeddingStatus } from '../../embeddings/embedding-status.js';
import { getMlClient } from '../../embeddings/ml.client.js';

export default async function (fastify: FastifyInstance) {
    fastify.get(
        '/admin/embeddings',
        {
            preHandler: [fastify.authenticate, fastify.authenticateAdmin],
            schema: {
                description: 'Status of the local embedding pipeline: ML service health, coverage per kind, queue depth, backfill (admin only)',
                tags: ['Admin'],
                response: { 200: EmbeddingStatusResponseSchema },
            },
        },
        async () => loadEmbeddingStatus(db, getMlClient()),
    );
}

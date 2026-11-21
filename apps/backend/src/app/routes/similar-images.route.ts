import { SimilarImagesQuerySchema, SimilarImagesResponseSchema, UuidSchema, type SimilarImagesQuery } from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadOpenDocument } from '../../services/document-access';
import { fetchDocumentDetails } from '../../search/document-hydration';
import { parseQuery } from '../../search/query-parser';
import { findSimilarImages } from '../../search/similar-images';

export default async function (fastify: FastifyInstance) {
    /**
     * GET /api/documents/:id/similar-images
     *
     * The images in the library that look most like this one, nearest first. A document in a locked
     * private folder is refused like every other read of it; the results never include private or
     * trashed images, even when the source itself is in an open private folder.
     */
    fastify.get<{ Params: { id: string }; Querystring: SimilarImagesQuery }>(
        '/documents/:id/similar-images',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Images that look like this one',
                tags: ['search'],
                params: z.object({ id: UuidSchema }),
                querystring: SimilarImagesQuerySchema,
                response: { 200: SimilarImagesResponseSchema },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const { locks } = await loadOpenDocument(fastify, request, request.params.id);
            const similar = await findSimilarImages(userId, locks.privateFolderIds, request.params.id, request.query);

            // No embedding yet (not an image, or not analysed yet): nothing to compare against.
            if (!similar) return { total: 0, results: [] };

            const details = await fetchDocumentDetails(
                userId,
                similar.entries.map((entry) => entry.id),
                parseQuery(''),
            );
            const results = similar.entries.flatMap((entry) => {
                const hit = details.get(entry.id);

                return hit ? [{ ...hit, relevance: entry.similarity }] : [];
            });

            return { total: similar.total, results };
        },
    );
}

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
    SearchQuerySchema,
    SearchResponseSchema,
    SuggestQuerySchema,
    SuggestResponseSchema,
    FacetsQuerySchema,
    FacetsResponseSchema,
    type SearchQuery,
    type SuggestQuery,
    type FacetsQuery,
} from '@reverie/shared';
import { search, getFacetsOnly, suggest } from '../../search/search.service';

export default async function (fastify: FastifyInstance) {
    /**
     * Main search endpoint
     *
     * GET /api/search?q=type:photo folder:vacation uploaded:2024
     *
     * Supports:
     * - Free text search: q=beach sunset
     * - Filters: type:photo, format:pdf, category:receipt
     * - Date ranges: uploaded:2024, date:2022-2025
     * - Folder: folder:/vacation/2024
     * - Properties: has:text, -has:summary
     * - Size: size:>10MB
     * - Entities: entity:Apple, company:"John Smith"
     * - Tags: tag:important
     */
    fastify.get<{
        Querystring: SearchQuery;
    }>(
        '/search',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Search documents with advanced query syntax',
                tags: ['search'],
                querystring: SearchQuerySchema,
                response: {
                    200: SearchResponseSchema,
                    400: z.object({
                        statusCode: z.number(),
                        error: z.string(),
                        message: z.string(),
                    }),
                },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;

            try {
                const response = await search(request.query, { userId });
                return response;
            } catch (error) {
                if (error instanceof Error && error.message.startsWith('Invalid query:')) {
                    return reply.badRequest(error.message);
                }
                throw error;
            }
        },
    );

    /**
     * Get facets only (without search results)
     *
     * GET /api/search/facets?q=folder:vacation
     *
     * Returns counts for filter options based on current query.
     */
    fastify.get<{
        Querystring: FacetsQuery;
    }>(
        '/search/facets',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get facet counts for filtering',
                tags: ['search'],
                querystring: FacetsQuerySchema,
                response: {
                    200: FacetsResponseSchema,
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const facets = await getFacetsOnly(request.query.q, userId);
            return { facets };
        },
    );

    /**
     * Autocomplete suggestions
     *
     * GET /api/search/suggest?type=filename&q=vacation
     * GET /api/search/suggest?type=folder&q=/photos
     * GET /api/search/suggest?type=tag&q=imp
     * GET /api/search/suggest?type=entity&q=App
     * GET /api/search/suggest?type=category&q=rec
     */
    fastify.get<{
        Querystring: SuggestQuery;
    }>(
        '/search/suggest',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get autocomplete suggestions',
                tags: ['search'],
                querystring: SuggestQuerySchema,
                response: {
                    200: SuggestResponseSchema,
                },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const suggestions = await suggest(request.query, userId);
            return suggestions;
        },
    );

    /**
     * Quick search filters (predefined shortcuts)
     *
     * GET /api/search/quick-filters
     */
    fastify.get(
        '/search/quick-filters',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get predefined quick search filters',
                tags: ['search'],
                response: {
                    200: z.array(
                        z.object({
                            label: z.string(),
                            query: z.string(),
                            icon: z.string().optional(),
                        }),
                    ),
                },
            },
        },
        async function () {
            return [
                { label: 'Photos', query: 'type:photo', icon: 'image' },
                { label: 'Documents', query: 'type:document', icon: 'file-text' },
                { label: 'Receipts', query: 'category:transaction_receipt', icon: 'receipt' },
                { label: 'Recent', query: 'uploaded:last-week', icon: 'clock' },
                { label: 'Large files', query: 'size:>10MB', icon: 'hard-drive' },
                { label: 'No text', query: '-has:text', icon: 'image' },
                { label: 'With summary', query: 'has:summary', icon: 'file-text' },
                { label: 'Stock statements', query: 'category:stock_overview', icon: 'trending-up' },
            ];
        },
    );

    /**
     * Search syntax help
     *
     * GET /api/search/help
     */
    fastify.get(
        '/search/help',
        {
            schema: {
                description: 'Get search syntax help',
                tags: ['search'],
                response: {
                    200: z.object({
                        filters: z.array(
                            z.object({
                                name: z.string(),
                                syntax: z.string(),
                                examples: z.array(z.string()),
                                description: z.string(),
                            }),
                        ),
                        examples: z.array(
                            z.object({
                                query: z.string(),
                                description: z.string(),
                            }),
                        ),
                    }),
                },
            },
        },
        async function () {
            return {
                filters: [
                    {
                        name: 'type',
                        syntax: 'type:<category>',
                        examples: ['type:photo', 'type:document', 'type:receipt'],
                        description: 'Filter by file type',
                    },
                    {
                        name: 'format',
                        syntax: 'format:<ext>',
                        examples: ['format:pdf', 'format:jpg', 'format:png'],
                        description: 'Filter by file format/extension',
                    },
                    {
                        name: 'category',
                        syntax: 'category:<name>',
                        examples: ['category:stock_overview', 'category:transaction_receipt'],
                        description: 'Filter by document category',
                    },
                    {
                        name: 'uploaded',
                        syntax: 'uploaded:<date>',
                        examples: ['uploaded:2024', 'uploaded:last-week', 'uploaded:2024-01..2024-06'],
                        description: 'Filter by upload date',
                    },
                    {
                        name: 'date',
                        syntax: 'date:<date>',
                        examples: ['date:2023', 'date:2022-2025'],
                        description: 'Filter by extracted document date',
                    },
                    {
                        name: 'folder',
                        syntax: 'folder:<path>',
                        examples: ['folder:/vacation/2024', 'folder:receipts'],
                        description: 'Filter by folder path',
                    },
                    {
                        name: 'tag',
                        syntax: 'tag:<name>',
                        examples: ['tag:important', 'tag:tax'],
                        description: 'Filter by tag',
                    },
                    {
                        name: 'has',
                        syntax: 'has:<property>',
                        examples: ['has:text', 'has:summary', '-has:thumbnail'],
                        description: 'Filter by document properties',
                    },
                    {
                        name: 'size',
                        syntax: 'size:<comparison>',
                        examples: ['size:>1MB', 'size:<100KB'],
                        description: 'Filter by file size',
                    },
                    {
                        name: 'entity',
                        syntax: 'entity:<name>',
                        examples: ['entity:Apple', 'company:"John Smith"'],
                        description: 'Filter by extracted entities (companies, people)',
                    },
                    {
                        name: 'in',
                        syntax: 'in:<scope>',
                        examples: ['in:filename vacation', 'in:content Apple', 'in:summary tax'],
                        description: 'Limit text search to specific fields',
                    },
                ],
                examples: [
                    { query: 'vacation beach', description: 'Search for "vacation beach" in all fields' },
                    { query: 'type:photo folder:vacation uploaded:2024', description: 'Photos in vacation folder from 2024' },
                    { query: 'category:stock_overview company:Apple date:2022-2025', description: 'Apple stock statements from 2022-2025' },
                    { query: 'format:pdf folder:/documents/tax', description: 'PDFs in tax folder' },
                    { query: 'size:>5MB -has:thumbnail', description: 'Large files without thumbnails' },
                    { query: '"dividend payment" category:dividend_statement', description: 'Dividend statements containing "dividend payment"' },
                ],
            };
        },
    );
}

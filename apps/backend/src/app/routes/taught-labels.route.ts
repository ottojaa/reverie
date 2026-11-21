import {
    AddExamplesRequestSchema,
    TaughtLabelDetailQuerySchema,
    TaughtLabelDetailResponseSchema,
    TaughtLabelListResponseSchema,
    TaughtLabelSchema,
    TaughtLabelSimilaritiesResponseSchema,
    TeachLabelRequestSchema,
    TeachLabelResponseSchema,
    UpdateTaughtLabelRequestSchema,
    UuidSchema,
    type AddExamplesRequest,
    type TaughtLabelDetailQuery,
    type TeachLabelRequest,
    type UpdateTaughtLabelRequest,
} from '@reverie/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/kysely';
import { parseQuery } from '../../search/query-parser';
import { fetchDocumentDetails } from '../../search/document-hydration';
import { assertDocumentsOpen } from '../../services/document-access';
import { loadFolderLocks } from '../../services/folder-locks';
import {
    addLabelExamples,
    deleteLabel,
    fetchLabel,
    listLabels,
    loadLabelMembers,
    loadSimilarities,
    removeLabelExample,
    removeLabelMatch,
    setLabelThreshold,
    teachLabel,
    toLabelDtos,
    type TeachResult,
} from '../../taught-labels/taught-labels.service';

const labelParams = z.object({ id: UuidSchema });
const labelDocumentParams = z.object({ id: UuidSchema, documentId: UuidSchema });

export default async function (fastify: FastifyInstance) {
    /** Everything the owner can see: live images outside private folders (the same rule search follows). */
    async function loadPrivateFolderIds(request: FastifyRequest): Promise<string[]> {
        return (await loadFolderLocks(fastify, request, request.user.id)).privateFolderIds;
    }

    async function toTeachResponse(request: FastifyRequest, result: TeachResult) {
        const [label] = await toLabelDtos(db, request.user.id, [result.label], await loadPrivateFolderIds(request));

        return { label: label!, added: result.added, skipped: result.skipped };
    }

    /** A private example can only be taught while its folder is open. */
    async function assertOpen(request: FastifyRequest, documentIds: string[]) {
        await assertDocumentsOpen(await loadFolderLocks(fastify, request, request.user.id), request.user.id, documentIds);
    }

    fastify.get(
        '/taught-labels',
        {
            preHandler: [fastify.authenticate],
            schema: { description: 'Labels taught by example', tags: ['taught-labels'], response: { 200: TaughtLabelListResponseSchema } },
        },
        async function (request) {
            return { labels: await listLabels(request.user.id, await loadPrivateFolderIds(request)) };
        },
    );

    fastify.post<{ Body: TeachLabelRequest }>(
        '/taught-labels',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Teach a label from example images; an existing name adds to that label',
                tags: ['taught-labels'],
                body: TeachLabelRequestSchema,
                response: { 200: TeachLabelResponseSchema },
            },
        },
        async function (request) {
            await assertOpen(request, request.body.document_ids);

            return toTeachResponse(request, await teachLabel(request.user.id, request.body.name, request.body.document_ids));
        },
    );

    fastify.get<{ Params: { id: string }; Querystring: TaughtLabelDetailQuery }>(
        '/taught-labels/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'A taught label with its examples and a page of its matches',
                tags: ['taught-labels'],
                params: labelParams,
                querystring: TaughtLabelDetailQuerySchema,
                response: { 200: TaughtLabelDetailResponseSchema },
            },
        },
        async function (request) {
            const userId = request.user.id;
            const privateFolderIds = await loadPrivateFolderIds(request);
            const label = await fetchLabel(userId, request.params.id);
            const members = await loadLabelMembers(label, privateFolderIds, request.query);
            const details = await fetchDocumentDetails(userId, [...members.exampleIds, ...members.matchIds], parseQuery(''));
            const toResults = (ids: string[]) => ids.flatMap((id) => details.get(id) ?? []);
            const [dto] = await toLabelDtos(db, userId, [label], privateFolderIds);

            return { label: dto!, examples: toResults(members.exampleIds), matches: toResults(members.matchIds), match_total: members.matchTotal };
        },
    );

    fastify.get<{ Params: { id: string } }>(
        '/taught-labels/:id/similarities',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Best similarity of every image the label could match, for counting a threshold',
                tags: ['taught-labels'],
                params: labelParams,
                response: { 200: TaughtLabelSimilaritiesResponseSchema },
            },
        },
        async function (request) {
            return loadSimilarities(await fetchLabel(request.user.id, request.params.id), await loadPrivateFolderIds(request));
        },
    );

    fastify.patch<{ Params: { id: string }; Body: UpdateTaughtLabelRequest }>(
        '/taught-labels/:id',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: "Set a label's similarity threshold and apply it",
                tags: ['taught-labels'],
                params: labelParams,
                body: UpdateTaughtLabelRequestSchema,
                response: { 200: TaughtLabelSchema },
            },
        },
        async function (request) {
            const label = await setLabelThreshold(request.user.id, request.params.id, request.body.threshold);

            const [dto] = await toLabelDtos(db, request.user.id, [label], await loadPrivateFolderIds(request));

            return dto!;
        },
    );

    fastify.post<{ Params: { id: string }; Body: AddExamplesRequest }>(
        '/taught-labels/:id/examples',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Add example images to a label',
                tags: ['taught-labels'],
                params: labelParams,
                body: AddExamplesRequestSchema,
                response: { 200: TeachLabelResponseSchema },
            },
        },
        async function (request) {
            await assertOpen(request, request.body.document_ids);

            return toTeachResponse(request, await addLabelExamples(request.user.id, request.params.id, request.body.document_ids));
        },
    );

    fastify.delete<{ Params: { id: string; documentId: string } }>(
        '/taught-labels/:id/examples/:documentId',
        {
            preHandler: [fastify.authenticate],
            schema: { description: 'Remove an example from a label', tags: ['taught-labels'], params: labelDocumentParams },
        },
        async function (request, reply) {
            await removeLabelExample(request.user.id, request.params.id, request.params.documentId);

            return reply.status(204).send();
        },
    );

    fastify.delete<{ Params: { id: string; documentId: string } }>(
        '/taught-labels/:id/matches/:documentId',
        {
            preHandler: [fastify.authenticate],
            schema: { description: 'Remove a label from an image and keep it from coming back', tags: ['taught-labels'], params: labelDocumentParams },
        },
        async function (request, reply) {
            await assertOpen(request, [request.params.documentId]);
            await removeLabelMatch(request.user.id, request.params.id, request.params.documentId);

            return reply.status(204).send();
        },
    );

    fastify.delete<{ Params: { id: string } }>(
        '/taught-labels/:id',
        {
            preHandler: [fastify.authenticate],
            schema: { description: 'Delete a label and the taught tags it put on images', tags: ['taught-labels'], params: labelParams },
        },
        async function (request, reply) {
            await deleteLabel(request.user.id, request.params.id);

            return reply.status(204).send();
        },
    );
}

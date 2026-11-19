import {
    ApiTokenParamsSchema,
    CreateApiTokenRequestSchema,
    CreateApiTokenResponseSchema,
    ListApiTokensResponseSchema,
    NotFoundError,
    type ApiToken as ApiTokenDto,
} from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiToken } from '../../db/schema.js';
import { createApiToken, listApiTokens, revokeApiToken } from '../../services/api-token.service.js';

function toApiTokenDto(token: ApiToken): ApiTokenDto {
    return {
        id: token.id,
        name: token.name,
        prefix: token.token_prefix,
        created_at: token.created_at.toISOString(),
        last_used_at: token.last_used_at?.toISOString() ?? null,
    };
}

/** Token management is for the logged-in user only: an API token cannot list, mint or revoke tokens. */
export default async function (fastify: FastifyInstance) {
    const preHandler = [fastify.authenticate];

    fastify.get(
        '/api-tokens',
        {
            preHandler,
            schema: {
                description: "List the caller's active API tokens (never the secrets)",
                tags: ['API tokens'],
                response: { 200: ListApiTokensResponseSchema },
            },
        },
        async (request) => ({ tokens: (await listApiTokens(request.user.id)).map(toApiTokenDto) }),
    );

    fastify.post(
        '/api-tokens',
        {
            preHandler,
            config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
            schema: {
                description: 'Create an API token. The secret is in this response only and cannot be shown again',
                tags: ['API tokens'],
                body: CreateApiTokenRequestSchema,
                response: { 201: CreateApiTokenResponseSchema },
            },
        },
        async (request, reply) => {
            const { name } = request.body as { name: string };
            const { token, secret } = await createApiToken(request.user.id, name);

            return reply.status(201).send({ token: toApiTokenDto(token), secret });
        },
    );

    fastify.delete(
        '/api-tokens/:id',
        {
            preHandler,
            schema: {
                description: 'Revoke an API token: it stops working on the next request',
                tags: ['API tokens'],
                params: ApiTokenParamsSchema,
                response: { 204: z.null() },
            },
        },
        async (request, reply) => {
            const { id } = request.params as { id: string };

            if (!(await revokeApiToken(request.user.id, id))) throw new NotFoundError('API token', id);

            return reply.status(204).send();
        },
    );
}

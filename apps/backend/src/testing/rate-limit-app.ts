import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions, type InjectOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import apiTokenAuthPlugin from '../app/plugins/api-token-auth.js';
import authPlugin from '../app/plugins/auth.js';
import errorHandler from '../app/plugins/error-handler.js';
import multipartPlugin from '../app/plugins/multipart.js';
import rateLimitPlugin from '../app/plugins/rate-limit.js';
import agentRoute from '../app/routes/agent.route.js';
import apiTokensRoute from '../app/routes/api-tokens.route.js';
import authRoute from '../app/routes/auth.route.js';
import mcpUploadRoute from '../app/routes/mcp-upload.route.js';
import mcpRoute from '../app/routes/mcp.route.js';
import oidcRoute from '../app/routes/oidc.route.js';
import uploadRoute from '../app/routes/upload.route.js';
import vaultRoute from '../app/routes/vault.route.js';

/**
 * The real limiter and the real routes it matters for, registered in the order the server loads them. The
 * limiter counts a request before anything else looks at it, so a test needs no database: a request that
 * goes on to fail its sign-in or its schema was still counted. The importing test mocks the database, the
 * env and the queues.
 */
export async function buildRateLimitedApp(trustProxy?: FastifyServerOptions['trustProxy']): Promise<FastifyInstance> {
    const app = Fastify({ trustProxy });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    for (const plugin of [sensible, apiTokenAuthPlugin, authPlugin, errorHandler, multipartPlugin, rateLimitPlugin]) await app.register(plugin);

    for (const route of [agentRoute, apiTokensRoute, authRoute, mcpRoute, mcpUploadRoute, oidcRoute, uploadRoute, vaultRoute]) await app.register(route);

    await app.ready();

    return app;
}

export const ALICE = '11111111-1111-4111-8111-111111111111';
export const BOB = '22222222-2222-4222-8222-222222222222';
export const HOME = '10.0.0.1';
export const ELSEWHERE = '10.0.0.2';

export function toLoginToken(app: FastifyInstance, userId: string): string {
    return app.jwt.sign({ sub: userId, email: userId + '@example.test' });
}

export interface Sent {
    method?: InjectOptions['method'];
    url: string;
    from?: string;
    /** The request's X-Forwarded-For header. */
    forwardedFor?: string;
    bearer?: string;
}

/** One request, with what the limiter said about the count it went into. */
export async function sendCounted(app: FastifyInstance, { method = 'GET', url, from = HOME, forwardedFor, bearer }: Sent) {
    const headers = {
        ...(bearer && { authorization: 'Bearer ' + bearer }),
        ...(forwardedFor && { 'x-forwarded-for': forwardedFor }),
    };
    const response = await app.inject({ method, url, remoteAddress: from, headers });

    return {
        status: response.statusCode,
        limit: Number(response.headers['x-ratelimit-limit']),
        remaining: Number(response.headers['x-ratelimit-remaining']),
        windowSeconds: Number(response.headers['x-ratelimit-reset']),
        retryAfter: Number(response.headers['retry-after']),
        body: response.body,
    };
}

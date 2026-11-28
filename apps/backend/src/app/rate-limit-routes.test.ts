import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/recording-db.js')).createRecordingDb().db }));
vi.mock('../config/env', async () => ({ env: (await import('../testing/upload-env.js')).testEnv }));
vi.mock('../queues/ocr.queue', async () => (await import('../testing/upload-env.js')).ocrQueueStub);
vi.mock('../queues/thumbnail.queue', async () => (await import('../testing/upload-env.js')).thumbnailQueueStub);

import { ALICE, BOB, buildRateLimitedApp, ELSEWHERE, sendCounted, toLoginToken, type Sent } from '../testing/rate-limit-app.js';

/**
 * Sign-in, secrets, API tokens, the agent and MCP have limits of their own, which signing in must not move
 * from the caller's address (MCP: from its token) to the user.
 */

let app: FastifyInstance;

const send = (sent: Sent) => sendCounted(app, sent);

beforeEach(async () => {
    app = await buildRateLimitedApp();
});
afterEach(() => app.close());

describe('a route with a limit per address', () => {
    it.each([
        ['POST', '/auth/login', 30, 900],
        ['POST', '/auth/refresh', 120, 900],
        ['POST', '/auth/change-password', 30, 900],
        ['POST', '/auth/exchange-oauth-code', 30, 900],
        ['GET', '/auth/oidc/google', 60, 900],
        ['GET', '/auth/oidc/google/callback', 60, 900],
        ['GET', '/auth/google', 60, 900],
        ['GET', '/auth/google/callback', 60, 900],
        ['POST', '/api-tokens', 20, 900],
        ['POST', '/vault/unlock', 30, 900],
        ['PUT', '/vault/secret', 30, 900],
        ['POST', '/agent/messages', 30, 60],
        ['POST', '/mcp/upload', 30, 60],
    ] as const)('%s %s takes %i in %i seconds, counted together for everyone at one address', async (method, url, max, seconds) => {
        const route = { method, url };

        expect(await send({ ...route, bearer: toLoginToken(app, ALICE) })).toMatchObject({ limit: max, remaining: max - 1, windowSeconds: seconds });
        expect(await send({ ...route, bearer: toLoginToken(app, BOB) })).toMatchObject({ remaining: max - 2 });
        expect(await send(route)).toMatchObject({ remaining: max - 3 });
        expect(await send({ ...route, bearer: toLoginToken(app, ALICE), from: ELSEWHERE })).toMatchObject({ remaining: max - 1 });
    });
});

describe('POST /mcp', () => {
    const mcp = (bearer?: string, from?: string): Sent => ({ method: 'POST', url: '/mcp', bearer, from });

    it('takes 300 a minute for each API token, from wherever it is used', async () => {
        expect(await send(mcp('rvr_first'))).toMatchObject({ status: 401, limit: 300, remaining: 299, windowSeconds: 60 });
        expect(await send(mcp('rvr_first', ELSEWHERE))).toMatchObject({ remaining: 298 });
        expect(await send(mcp('rvr_second'))).toMatchObject({ remaining: 299 });
    });

    it('counts a request with no token against its address', async () => {
        expect(await send(mcp())).toMatchObject({ remaining: 299 });
        expect(await send(mcp())).toMatchObject({ remaining: 298 });
        expect(await send(mcp(undefined, ELSEWHERE))).toMatchObject({ remaining: 299 });
    });
});

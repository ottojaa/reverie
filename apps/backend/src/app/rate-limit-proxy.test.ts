import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/recording-db.js')).createRecordingDb().db }));
vi.mock('../config/env', async () => ({ env: (await import('../testing/upload-env.js')).testEnv }));
vi.mock('../queues/ocr.queue', async () => (await import('../testing/upload-env.js')).ocrQueueStub);
vi.mock('../queues/thumbnail.queue', async () => (await import('../testing/upload-env.js')).thumbnailQueueStub);

import { trustProxySchema } from '../config/trust-proxy.js';
import { ALICE, buildRateLimitedApp, sendCounted, toLoginToken, type Sent } from '../testing/rate-limit-app.js';

/** Who a limit per address counts, behind a reverse proxy that `TRUST_PROXY` lists. */

/** Where the proxy's requests arrive from: the container network's gateway. */
const GATEWAY = '172.18.0.1';
/** Another container on that network, which reaches the server without the proxy. */
const CONTAINER = '172.18.0.5';
const PHONE = '203.0.113.7';
const STRANGER = '198.51.100.23';
const LOGIN: Sent = { method: 'POST', url: '/auth/login' };
const LOGIN_MAX = 30;

let app: FastifyInstance;

const send = (sent: Sent) => sendCounted(app, sent);

/** As nginx sends it: `$proxy_add_x_forwarded_for` puts the client's address after whatever the client wrote. */
const viaProxy = (sent: Sent, client: string, written?: string): Sent => ({
    ...sent,
    from: GATEWAY,
    forwardedFor: written ? written + ', ' + client : client,
});

async function start(trustProxy: string | undefined): Promise<void> {
    app = await buildRateLimitedApp(trustProxySchema.parse(trustProxy));
}

afterEach(() => app.close());

describe('with the proxy trusted', () => {
    it('does not let one client use up the sign-in limit of another', async () => {
        await start(GATEWAY);

        for (let attempt = 1; attempt <= LOGIN_MAX; attempt++) expect((await send(viaProxy(LOGIN, STRANGER))).status).not.toBe(429);

        expect((await send(viaProxy(LOGIN, STRANGER))).status).toBe(429);

        const owner = await send(viaProxy(LOGIN, PHONE));

        expect(owner).toMatchObject({ limit: LOGIN_MAX, remaining: LOGIN_MAX - 1 });
        expect(owner.status).not.toBe(429);
    });

    it.each([
        ['made-up addresses', ['192.0.2.1', '192.0.2.2, 192.0.2.3']],
        ["another client's address", [PHONE, PHONE]],
        ["the proxy's own address", [GATEWAY, GATEWAY + ', ' + GATEWAY]],
        ['text that is no address', ['unknown', '<script>']],
    ])('counts the address the proxy added, whatever the client wrote before it: %s', async (_what, written) => {
        await start(GATEWAY);
        await send(viaProxy(LOGIN, STRANGER));

        for (const [index, forged] of written.entries()) {
            expect(await send(viaProxy(LOGIN, STRANGER, forged))).toMatchObject({ remaining: LOGIN_MAX - 2 - index });
        }

        expect(await send(viaProxy(LOGIN, PHONE))).toMatchObject({ remaining: LOGIN_MAX - 1 });
    });

    it.each([CONTAINER, STRANGER])('ignores X-Forwarded-For from %s, which is not listed', async (peer) => {
        await start(GATEWAY);

        expect(await send({ ...LOGIN, from: peer })).toMatchObject({ remaining: LOGIN_MAX - 1 });

        for (const [index, forwardedFor] of [PHONE, '192.0.2.1', GATEWAY, PHONE + ', ' + GATEWAY].entries()) {
            expect(await send({ ...LOGIN, from: peer, forwardedFor })).toMatchObject({ remaining: LOGIN_MAX - 2 - index });
        }

        expect(await send(viaProxy(LOGIN, PHONE))).toMatchObject({ remaining: LOGIN_MAX - 1 });
    });

    it('takes the proxy in its IPv4-mapped form, as a server listening on IPv6 sees it', async () => {
        await start(GATEWAY);
        await send({ ...viaProxy(LOGIN, PHONE), from: '::ffff:' + GATEWAY });

        expect(await send(viaProxy(LOGIN, PHONE))).toMatchObject({ remaining: LOGIN_MAX - 2 });
    });

    it.each([
        ['the general limit, signed out', { url: '/auth/me' }],
        ['token refresh', { method: 'POST', url: '/auth/refresh' }],
        ['external sign-in', { url: '/auth/oidc/google' }],
        ['API tokens', { method: 'POST', url: '/api-tokens' }],
        ['vault unlock', { method: 'POST', url: '/vault/unlock' }],
        ['agent messages', { method: 'POST', url: '/agent/messages' }],
        ['MCP uploads', { method: 'POST', url: '/mcp/upload' }],
        ['MCP without a token', { method: 'POST', url: '/mcp' }],
    ] satisfies [string, Sent][])('counts each client apart: %s', async (_what, route) => {
        await start(GATEWAY);

        const first = await send(viaProxy(route, PHONE));

        expect(await send(viaProxy(route, PHONE))).toMatchObject({ remaining: first.remaining - 1 });
        expect(await send(viaProxy(route, STRANGER))).toMatchObject({ limit: first.limit, remaining: first.limit - 1 });
    });

    it('still counts a signed-in user once, from any address', async () => {
        await start(GATEWAY);

        const me: Sent = { url: '/auth/me', bearer: toLoginToken(app, ALICE) };
        const first = await send(viaProxy(me, PHONE));

        expect(await send(viaProxy(me, STRANGER))).toMatchObject({ remaining: first.remaining - 1 });
    });
});

describe('with no proxy trusted', () => {
    it.each([undefined, ''])('ignores X-Forwarded-For, so everyone behind a proxy shares one count (TRUST_PROXY=%o)', async (value) => {
        await start(value);

        expect(await send(viaProxy(LOGIN, PHONE))).toMatchObject({ remaining: LOGIN_MAX - 1 });
        expect(await send(viaProxy(LOGIN, STRANGER))).toMatchObject({ remaining: LOGIN_MAX - 2 });
    });
});

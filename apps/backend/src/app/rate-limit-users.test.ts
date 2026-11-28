import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/recording-db.js')).createRecordingDb().db }));
vi.mock('../config/env', async () => ({ env: (await import('../testing/upload-env.js')).testEnv }));
vi.mock('../queues/ocr.queue', async () => (await import('../testing/upload-env.js')).ocrQueueStub);
vi.mock('../queues/thumbnail.queue', async () => (await import('../testing/upload-env.js')).thumbnailQueueStub);

import { ALICE, BOB, buildRateLimitedApp, ELSEWHERE, sendCounted, toLoginToken, type Sent } from '../testing/rate-limit-app.js';
import { testEnv } from '../testing/upload-env.js';

const GENERAL_MAX = 2500;
const UPLOAD_MAX = 3600;
const GENERAL: Sent = { url: '/auth/me' };
const UPLOAD: Sent = { method: 'POST', url: '/upload' };
const REFUSAL = { statusCode: 429, error: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded, retry in 15 minutes' };

let app: FastifyInstance;

const send = (sent: Sent) => sendCounted(app, sent);

/** A JWT put together by hand, for the ones the server's own signer would not make. */
function toForgedToken(payload: object, secret: string): string {
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const signed = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode(payload);

    return signed + '.' + createHmac('sha256', secret).update(signed).digest('base64url');
}

async function useUp(sent: Sent, max: number): Promise<void> {
    for (let request = 1; request < max; request++) await send(sent);

    const last = await send(sent);

    expect(last.remaining).toBe(0);
    expect(last.status).not.toBe(429);
}

beforeEach(async () => {
    app = await buildRateLimitedApp();
});
afterEach(() => app.close());

describe('the general limit', () => {
    it('counts each signed-in user apart, wherever they are', async () => {
        const alice = toLoginToken(app, ALICE);

        expect(await send({ ...GENERAL, bearer: alice })).toMatchObject({ limit: GENERAL_MAX, remaining: GENERAL_MAX - 1, windowSeconds: 900 });
        expect(await send({ ...GENERAL, bearer: toLoginToken(app, BOB) })).toMatchObject({ remaining: GENERAL_MAX - 1 });
        expect(await send({ ...GENERAL, bearer: alice, from: ELSEWHERE })).toMatchObject({ remaining: GENERAL_MAX - 2 });
        expect(await send({ url: '/api-tokens', bearer: alice })).toMatchObject({ remaining: GENERAL_MAX - 3 });
    });

    it('counts a request that is not signed in against its address', async () => {
        expect(await send(GENERAL)).toMatchObject({ remaining: GENERAL_MAX - 1 });
        expect(await send(GENERAL)).toMatchObject({ remaining: GENERAL_MAX - 2 });
        expect(await send({ ...GENERAL, from: ELSEWHERE })).toMatchObject({ remaining: GENERAL_MAX - 1 });
    });

    it('gives no count of its own to a token that is not a valid login', async () => {
        const claims = { sub: ALICE, email: 'x@example.test' };
        const vaultClaims = { ...claims, scope: 'vault' };
        const notLogins = [
            'made-up',
            'rvr_an-api-token',
            toForgedToken(claims, 'x'.repeat(32)),
            toForgedToken({ ...claims, exp: 1_000_000 }, testEnv.JWT_SECRET),
            app.jwt.sign(vaultClaims),
        ];

        await send(GENERAL);

        for (const [index, bearer] of notLogins.entries()) {
            expect(await send({ ...GENERAL, bearer })).toMatchObject({ remaining: GENERAL_MAX - 2 - index });
        }
    });

    it('refuses the user who used it up and nobody else, and leaves their uploads alone', async () => {
        const alice = toLoginToken(app, ALICE);

        await useUp({ ...GENERAL, bearer: alice }, GENERAL_MAX);

        const refused = await send({ ...GENERAL, bearer: alice });

        expect(refused.status).toBe(429);
        expect(JSON.parse(refused.body)).toEqual(REFUSAL);
        expect(refused.retryAfter).toBeGreaterThan(0);
        expect((await send({ ...GENERAL, bearer: toLoginToken(app, BOB) })).status).not.toBe(429);
        expect((await send(GENERAL)).status).not.toBe(429);
        expect(await send({ ...UPLOAD, bearer: alice })).toMatchObject({ remaining: UPLOAD_MAX - 1 });
    });
});

describe('the upload limit', () => {
    it('is a count of its own for each user, and for each address that is not signed in', async () => {
        const alice = toLoginToken(app, ALICE);

        expect(await send({ ...UPLOAD, bearer: alice })).toMatchObject({ limit: UPLOAD_MAX, remaining: UPLOAD_MAX - 1, windowSeconds: 900 });
        expect(await send({ ...UPLOAD, bearer: toLoginToken(app, BOB) })).toMatchObject({ remaining: UPLOAD_MAX - 1 });
        expect(await send(UPLOAD)).toMatchObject({ status: 401, remaining: UPLOAD_MAX - 1 });
        expect(await send({ ...GENERAL, bearer: alice })).toMatchObject({ remaining: GENERAL_MAX - 1 });
    });

    it('refuses further uploads once used up, while the user can still browse', async () => {
        const alice = toLoginToken(app, ALICE);

        await useUp({ ...UPLOAD, bearer: alice }, UPLOAD_MAX);

        const refused = await send({ ...UPLOAD, bearer: alice });

        expect(refused.status).toBe(429);
        expect(JSON.parse(refused.body)).toEqual(REFUSAL);
        expect(refused.retryAfter).toBeGreaterThan(0);
        expect((await send({ ...UPLOAD, bearer: toLoginToken(app, BOB) })).status).not.toBe(429);
        expect(await send({ ...GENERAL, bearer: alice })).toMatchObject({ remaining: GENERAL_MAX - 1 });
    });

    it('leaves a quarter of itself free of the Android photo backup', async () => {
        const budget = readFileSync(join(__dirname, '../../../android/app/src/main/java/com/reverie/app/data/backup/UploadBudget.kt'), 'utf8');
        const server = await send({ ...UPLOAD, bearer: toLoginToken(app, ALICE) });

        expect(budget).toContain(`UPLOAD_WINDOW_MS = ${server.windowSeconds / 60} * 60_000L`);
        expect(Number(/UPLOADS_PER_WINDOW = ([\d_]+)/.exec(budget)?.[1]?.replaceAll('_', ''))).toBe(server.limit * 0.75);
    });
});

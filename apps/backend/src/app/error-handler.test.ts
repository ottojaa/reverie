import sensible from '@fastify/sensible';
import { NotFoundError } from '@reverie/shared';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingDb } from '../testing/recording-db.js';

const h = vi.hoisted(() => ({ recording: undefined as unknown as RecordingDb }));

vi.mock('../db/kysely', async () => {
    const { createRecordingDb } = await import('../testing/recording-db.js');
    h.recording = createRecordingDb();

    return { db: h.recording.db };
});
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test' } }));

import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import adminRoute from './routes/admin.route.js';
import authRoute from './routes/auth.route.js';
import vaultRoute from './routes/vault.route.js';

/** Stands for what a user typed: it must come back in no answer and appear in no log line. */
const MARKER = 'MARKER-typed-secret';

const INVALID_JSON_BODY = { statusCode: 400, error: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' };
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ERROR_LEVEL = 50;

let app: FastifyInstance;
let logged: string[] = [];

/** Routes that fail in ways no real route can be made to without breaking something underneath it. */
function addFailingRoutes(server: FastifyInstance) {
    server.get('/test/broken', async () => {
        throw new Error('the disk is gone');
    });
    server.get('/test/broken-parse', async () => JSON.parse('not json') as unknown);
    server.get('/test/unavailable', async () => {
        throw server.httpErrors.serviceUnavailable('the model is down');
    });
    server.get('/test/missing', async () => {
        throw new NotFoundError('Thing', 'abc');
    });
}

async function send(options: InjectOptions) {
    const response = await app.inject(options);

    return { status: response.statusCode, headers: response.headers, raw: response.body, body: JSON.parse(response.body) as unknown };
}

const sendText = (method: 'POST' | 'PUT', url: string, payload: string, contentType = 'application/json') =>
    send({ method, url, payload, headers: { 'content-type': contentType, authorization: 'Bearer ' + toToken() } });

const postText = (url: string, payload: string, contentType?: string) => sendText('POST', url, payload, contentType);

const toToken = () => app.jwt.sign({ sub: USER_ID, email: 'x@example.test' });

const errorLines = () => logged.filter((line) => (JSON.parse(line) as { level: number }).level >= ERROR_LEVEL);

describe('the error handler', () => {
    beforeAll(async () => {
        app = Fastify({ logger: { level: 'trace', stream: { write: (line: string) => void logged.push(line) } } });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        for (const plugin of [sensible, rateLimitPlugin, authPlugin, errorHandler]) await app.register(plugin);
        for (const route of [authRoute, adminRoute, vaultRoute]) await app.register(route);
        addFailingRoutes(app);
        await app.ready();
    });
    beforeEach(() => {
        logged = [];
        h.recording.respond = undefined;
    });
    afterAll(() => app.close());

    describe('a body that is not JSON', () => {
        const bodies = [MARKER, `{"password":${MARKER}}`, `{"password":"${MARKER}`];

        // Admin and vault routes describe their 400 as `error` and `message`, so theirs has no status in the body.
        const { statusCode: _status, ...shortBody } = INVALID_JSON_BODY;

        it.each([
            ['POST', '/auth/login', INVALID_JSON_BODY],
            ['POST', '/auth/change-password', INVALID_JSON_BODY],
            ['POST', '/auth/exchange-oauth-code', INVALID_JSON_BODY],
            ['POST', '/admin/users', INVALID_JSON_BODY],
            ['POST', '/vault/unlock', shortBody],
            ['PUT', '/vault/secret', shortBody],
        ] as const)('answers 400 to %s %s and keeps what was typed out of the answer and the log', async (method, url, expected) => {
            for (const body of bodies) {
                const response = await sendText(method, url, body);

                expect(logged.join('')).not.toContain('MARKER');
                expect(response.raw).not.toContain('MARKER');
                expect(response.status).toBe(400);
                expect(response.body).toEqual(expected);
            }

            expect(logged.join('')).toContain(url);
            expect(errorLines()).toEqual([]);
        });
    });

    describe('an error with a 4xx status of its own', () => {
        it('answers a rate-limited request 429, saying when to retry', async () => {
            const login = () =>
                send({ method: 'POST', url: '/auth/login', remoteAddress: '10.0.0.1', payload: { email: 'x@example.test', password: 'wrong' } });

            for (let attempt = 0; attempt < 30; attempt++) expect((await login()).status).toBe(401);

            const refused = await login();

            expect(refused.status).toBe(429);
            expect(refused.body).toEqual({ statusCode: 429, error: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded, retry in 15 minutes' });
            expect(refused.headers['retry-after']).toBeDefined();
            expect(errorLines()).toEqual([]);
        });

        it('answers a body over the limit 413', async () => {
            const response = await postText('/auth/login', JSON.stringify({ password: 'x'.repeat(2 * 1024 * 1024) }));

            expect(response.status).toBe(413);
            expect(response.body).toEqual({ statusCode: 413, error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
            expect(errorLines()).toEqual([]);
        });

        it('answers a content type it cannot read 415', async () => {
            const response = await postText('/auth/login', MARKER, 'application/xml');

            expect(response.status).toBe(415);
            expect(response.body).toMatchObject({ statusCode: 415, error: 'UNSUPPORTED_MEDIA_TYPE' });
            expect(logged.join('')).not.toContain('MARKER');
            expect(errorLines()).toEqual([]);
        });

        it('answers an empty JSON body 400', async () => {
            const response = await postText('/auth/login', '');

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({ statusCode: 400, error: 'BAD_REQUEST' });
            expect(errorLines()).toEqual([]);
        });

        it('answers 401 when the signed-in user is gone', async () => {
            const response = await send({ method: 'GET', url: '/auth/me', headers: { authorization: 'Bearer ' + toToken() } });

            expect(response.status).toBe(401);
            expect(response.body).toEqual({ statusCode: 401, error: 'UNAUTHORIZED', message: 'User not found' });
            expect(errorLines()).toEqual([]);
        });
    });

    describe('answers that stay as they were', () => {
        it.each([
            ['an unknown error', '/test/broken'],
            ['a SyntaxError that is not from the body', '/test/broken-parse'],
            ['an error with a 5xx status', '/test/unavailable'],
        ])('answers %s 500 and logs it', async (_name, url) => {
            const response = await send({ method: 'GET', url });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({ statusCode: 500, error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
            expect(errorLines()).toHaveLength(1);
        });

        it('answers an AppError with its own envelope', async () => {
            const response = await send({ method: 'GET', url: '/test/missing' });

            expect(response.status).toBe(404);
            expect(response.raw).toBe('{"statusCode":404,"error":"NOT_FOUND","message":"Thing with id abc not found"}');
        });

        it('answers a body that fails its schema with the issues', async () => {
            const response = await send({ method: 'POST', url: '/auth/login', remoteAddress: '10.0.0.2', payload: { email: 'x@example.test' } });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({ statusCode: 400, error: 'VALIDATION_ERROR', details: [{ instancePath: '/password' }] });
        });

        it('keeps a wrong current password to error and message', async () => {
            const response = await postText('/auth/change-password', JSON.stringify({ current_password: 'wrong', new_password: 'long enough 123' }));

            expect(response.status).toBe(400);
            expect(response.raw).toBe('{"error":"password_mismatch","message":"Current password is incorrect"}');
        });
    });

    describe('routes that describe their own 400', () => {
        it.each(['/auth/change-password', '/auth/exchange-oauth-code'])('answers a body that fails its schema 400 on %s', async (url) => {
            const response = await postText(url, '{}');

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({ statusCode: 400, error: 'VALIDATION_ERROR' });
            expect(errorLines()).toEqual([]);
        });

        it('lets an admin route say why it refused', async () => {
            h.recording.respond = (query) => (query.includes('"role"') ? [{ role: 'admin' }] : undefined);

            const response = await send({ method: 'DELETE', url: '/admin/users/' + USER_ID, headers: { authorization: 'Bearer ' + toToken() } });

            expect(errorLines()).toEqual([]);
            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({ error: 'delete_user_failed' });
        });
    });
});

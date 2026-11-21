import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'sk-local-secret-123';

const h = vi.hoisted(() => {
    const users = new Map<string, { role: string }>();

    return {
        users,
        env: {
            JWT_SECRET: 's'.repeat(32),
            JWT_ACCESS_EXPIRES: '15m',
            ANTHROPIC_API_KEY: undefined as string | undefined,
            LLM_MAX_OUTPUT_TOKENS: 4000,
            LOCAL_LLM_API_KEY: 'sk-local-secret-123' as string | undefined,
            LOCAL_LLM_TIMEOUT_MS: 2000,
        },
    };
});

vi.mock('../../config/env.js', () => ({ env: h.env }));
// authenticateAdmin looks the caller's role up through this module; nothing else here touches the database.
vi.mock('../../db/kysely.js', () => ({
    db: {
        selectFrom: () => ({
            select: () => ({
                where: (_column: string, _op: string, id: string) => ({ executeTakeFirst: async () => h.users.get(id) }),
            }),
        }),
    },
}));

import authPlugin from '../plugins/auth.js';
import errorHandler from '../plugins/error-handler.js';
import llmRoute from './admin.llm.route.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

interface Seen {
    authorization: string | undefined;
    body: { model: string; messages: { content: string | { type: string; image_url?: { url: string } }[] }[] };
}

describe('POST /admin/llm/test', () => {
    let app: FastifyInstance;
    let stub: Server;
    let stubUrl: string;
    let adminToken: string;
    let userToken: string;
    let seen: Seen[];
    let respond: (seen: Seen) => { status: number; body: unknown };

    beforeAll(async () => {
        stub = createServer((req: IncomingMessage, res) => {
            const chunks: Buffer[] = [];

            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                const call: Seen = { authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };

                seen.push(call);

                const { status, body } = respond(call);

                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            });
        });
        await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
        stubUrl = 'http://127.0.0.1:' + (stub.address() as AddressInfo).port + '/v1';

        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(llmRoute);
        await app.ready();

        adminToken = app.jwt.sign({ sub: ADMIN_ID, email: 'admin@example.com' });
        userToken = app.jwt.sign({ sub: USER_ID, email: 'user@example.com' });
    });

    afterAll(async () => {
        await app.close();
        await new Promise((resolve) => stub.close(resolve));
    });

    beforeEach(() => {
        seen = [];
        h.users.set(ADMIN_ID, { role: 'admin' });
        h.users.set(USER_ID, { role: 'user' });
        h.env.ANTHROPIC_API_KEY = undefined;
        respond = () => ({
            status: 200,
            body: { choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 1 } },
        });
    });

    const test = (payload: object, token = adminToken) =>
        app.inject({ method: 'POST', url: '/admin/llm/test', payload, headers: { authorization: 'Bearer ' + token } });
    const draft = (overrides: object = {}) => ({ capability: 'summary', provider: 'openai-compatible', model: 'llama3.1:8b', base_url: stubUrl, ...overrides });

    it('rejects a request without a token, and a non-admin', async () => {
        expect((await app.inject({ method: 'POST', url: '/admin/llm/test', payload: draft() })).statusCode).toBe(401);
        expect((await test(draft(), userToken)).statusCode).toBe(403);
        expect(seen).toHaveLength(0);
    });

    it('reports the model reply for a working server, sending the key as a bearer token', async () => {
        const res = await test(draft());

        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ ok: true, provider: 'openai-compatible', model: 'llama3.1:8b', reply: 'ready', error: null });
        expect(seen).toHaveLength(1);
        expect(seen[0]!.authorization).toBe('Bearer ' + SECRET);
        expect(seen[0]!.body.model).toBe('llama3.1:8b');
    });

    it('tests an image capability by sending a small picture as a data URL, and reports what the model says', async () => {
        respond = () => ({ status: 200, body: { choices: [{ message: { content: 'Red.' }, finish_reason: 'stop' }] } });

        const res = await test(draft({ capability: 'image', model: 'llava:13b' }));

        expect(res.json()).toMatchObject({ ok: true, reply: 'Red.' });

        const parts = seen[0]!.body.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));

        expect(parts.find((part) => part.type === 'image_url')?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('reports a server error as a failed test, not an HTTP error, without the key in it', async () => {
        respond = () => ({ status: 500, body: { error: { message: 'model crashed for key ' + SECRET } } });

        const res = await test(draft());
        const body = res.json() as { ok: boolean; error: string; reply: unknown };

        expect(res.statusCode).toBe(200);
        expect(body).toMatchObject({ ok: false, reply: null });
        expect(body.error).toContain('500');
        expect(body.error).not.toContain(SECRET);
        expect(res.body).not.toContain(SECRET);
    });

    it('reports an unreachable server as a failed test', async () => {
        const res = await test(draft({ base_url: 'http://127.0.0.1:9/v1' }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ ok: false, reply: null });
        expect((res.json() as { error: string }).error.length).toBeGreaterThan(0);
    });

    it('says what is missing instead of calling anything', async () => {
        const noUrl = (await test(draft({ base_url: '' }))).json();
        const noModel = (await test(draft({ model: ' ' }))).json();
        const noKey = (await test(draft({ provider: 'anthropic', model: 'claude-haiku-5-5', base_url: '' }))).json();

        expect(noUrl).toMatchObject({ ok: false, error: 'A base URL is required for a local server.' });
        expect(noModel).toMatchObject({ ok: false, error: 'A model name is required for a local server.' });
        expect(noKey).toMatchObject({ ok: false, error: 'ANTHROPIC_API_KEY is not set on the server.' });
        expect(seen).toHaveLength(0);
    });

    it('rejects an unknown provider with 400', async () => {
        expect((await test(draft({ provider: 'gemini' }))).statusCode).toBe(400);
    });
});

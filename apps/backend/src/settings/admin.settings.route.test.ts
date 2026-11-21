import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const rows = new Map<string, { key: string; value: unknown; updated_at: Date; updated_by: string | null }>();
    const users = new Map<string, { role: string }>();

    return {
        rows,
        users,
        env: {
            JWT_SECRET: 's'.repeat(32),
            JWT_ACCESS_EXPIRES: '15m',
            TRASH_RETENTION_DAYS: 30,
            ANTHROPIC_SUMMARY_MODEL: 'claude-haiku-5-5',
            ANTHROPIC_VISION_MODEL: 'claude-haiku-5-5',
            LLM_VISION_ENABLED: false,
        },
    };
});

vi.mock('../config/env.js', () => ({ env: h.env }));
// authenticateAdmin looks the caller's role up through this module.
vi.mock('../db/kysely.js', () => ({
    db: {
        selectFrom: () => ({
            select: () => ({
                where: (_column: string, _op: string, id: string) => ({ executeTakeFirst: async () => h.users.get(id) }),
            }),
        }),
    },
}));
vi.mock('./settings.store.js', () => ({
    fetchSettingRow: async (key: string) => h.rows.get(key),
    fetchSettingRows: async () => [...h.rows.values()],
    upsertSettingRow: async (key: string, value: unknown, updatedBy: string) => {
        h.rows.set(key, { key, value, updated_at: new Date(), updated_by: updatedBy });
    },
    applySettingRows: async (upserts: { key: string; value: unknown }[], deletes: string[], updatedBy: string) => {
        for (const { key, value } of upserts) h.rows.set(key, { key, value, updated_at: new Date(), updated_by: updatedBy });
        for (const key of deletes) h.rows.delete(key);
    },
    deleteSettingRow: async (key: string) => {
        h.rows.delete(key);
    },
}));

import { getSetting } from './settings.service.js';
import authPlugin from '../app/plugins/auth.js';
import errorHandler from '../app/plugins/error-handler.js';
import settingsRoute from '../app/routes/admin.settings.route.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const URL = '/admin/settings/trash.retentionDays';

describe('admin settings routes', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(settingsRoute);
        await app.ready();

        adminToken = app.jwt.sign({ sub: ADMIN_ID, email: 'admin@example.com' });
        userToken = app.jwt.sign({ sub: USER_ID, email: 'user@example.com' });
    });

    afterAll(() => app.close());

    beforeEach(() => {
        h.rows.clear();
        h.users.set(ADMIN_ID, { role: 'admin' });
        h.users.set(USER_ID, { role: 'user' });
    });

    const asAdmin = (method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
        app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: 'Bearer ' + adminToken } });

    it('rejects a request without a token with 401', async () => {
        expect((await app.inject({ method: 'GET', url: '/admin/settings' })).statusCode).toBe(401);
    });

    it('answers 403 to a non-admin on every route', async () => {
        const headers = { authorization: 'Bearer ' + userToken };

        expect((await app.inject({ method: 'GET', url: '/admin/settings', headers })).statusCode).toBe(403);
        expect((await app.inject({ method: 'PUT', url: URL, headers, payload: { value: 10 } })).statusCode).toBe(403);
        expect((await app.inject({ method: 'DELETE', url: URL, headers })).statusCode).toBe(403);
        expect(
            (await app.inject({ method: 'PUT', url: '/admin/settings', headers, payload: { set: { 'llm.summary.provider': 'openai-compatible' } } }))
                .statusCode,
        ).toBe(403);
        expect(h.rows.size).toBe(0);
    });

    it('lists the setting with its default', async () => {
        const res = await asAdmin('GET', '/admin/settings');

        expect(res.statusCode).toBe(200);
        expect(res.json().settings).toContainEqual(
            expect.objectContaining({ key: 'trash.retentionDays', value: 30, default: 30, overridden: false, updated_at: null, updated_by: null }),
        );
        expect(res.json().settings).toContainEqual(expect.objectContaining({ key: 'llm.summary.provider', value: 'anthropic', overridden: false }));
    });

    it('stores a valid value and the next backend read returns it', async () => {
        const res = await asAdmin('PUT', URL, { value: 90 });

        expect(res.statusCode).toBe(200);
        expect(res.json().setting).toMatchObject({ key: 'trash.retentionDays', value: 90, default: 30, overridden: true, updated_by: ADMIN_ID });
        expect(await getSetting('trash.retentionDays')).toBe(90);
    });

    it.each([
        ['"30"', '30'],
        ['0', 0],
        ['3651', 3651],
        ['1.5', 1.5],
        ['null', null],
        ['true', true],
    ])('refuses %s with 400 and a readable message', async (_label, value) => {
        const res = await asAdmin('PUT', URL, { value });

        expect(res.statusCode).toBe(400);
        expect(res.json().message).toEqual(expect.any(String));
        expect(h.rows.size).toBe(0);
    });

    it('refuses a body without a value', async () => {
        expect((await asAdmin('PUT', URL, {})).statusCode).toBe(400);
    });

    it('answers 404 for an unknown key', async () => {
        expect((await asAdmin('PUT', '/admin/settings/nope.nothing', { value: 1 })).statusCode).toBe(404);
        expect((await asAdmin('DELETE', '/admin/settings/nope.nothing')).statusCode).toBe(404);
    });

    it('resets to the default and the next read returns it', async () => {
        await asAdmin('PUT', URL, { value: 90 });

        const res = await asAdmin('DELETE', URL);

        expect(res.statusCode).toBe(200);
        expect(res.json().setting).toMatchObject({ value: 30, overridden: false });
        expect(await getSetting('trash.retentionDays')).toBe(30);
    });

    describe('saving several settings at once', () => {
        const LOCAL = { 'llm.summary.provider': 'openai-compatible', 'llm.summary.model': 'llama3.1:8b', 'llm.summary.baseUrl': 'http://ollama:11434/v1' };

        it('writes the provider, model and URL together and answers with the new list', async () => {
            const res = await asAdmin('PUT', '/admin/settings', { set: LOCAL });

            expect(res.statusCode).toBe(200);
            expect(res.json().settings).toContainEqual(expect.objectContaining({ key: 'llm.summary.provider', value: 'openai-compatible', overridden: true }));
            expect([...h.rows.keys()].sort()).toEqual(Object.keys(LOCAL).sort());
        });

        it('resets keys in the same change, so going back to Anthropic drops the local model name', async () => {
            await asAdmin('PUT', '/admin/settings', { set: LOCAL });

            const res = await asAdmin('PUT', '/admin/settings', {
                set: { 'llm.summary.provider': 'anthropic' },
                reset: ['llm.summary.model', 'llm.summary.baseUrl'],
            });

            expect(res.statusCode).toBe(200);
            expect(res.json().settings).toContainEqual(expect.objectContaining({ key: 'llm.summary.model', value: 'claude-haiku-5-5', overridden: false }));
            expect([...h.rows.keys()]).toEqual(['llm.summary.provider']);
        });

        it('writes nothing when one value is refused', async () => {
            const res = await asAdmin('PUT', '/admin/settings', { set: { ...LOCAL, 'llm.summary.baseUrl': 'ftp://host' } });

            expect(res.statusCode).toBe(400);
            expect(h.rows.size).toBe(0);
        });

        it('refuses an unknown key with 404 and a key that is both set and reset with 400, writing nothing', async () => {
            expect((await asAdmin('PUT', '/admin/settings', { set: { 'nope.nothing': 1 } })).statusCode).toBe(404);
            expect((await asAdmin('PUT', '/admin/settings', { set: LOCAL, reset: ['nope.nothing'] })).statusCode).toBe(404);
            expect((await asAdmin('PUT', '/admin/settings', { set: LOCAL, reset: ['llm.summary.model'] })).statusCode).toBe(400);
            expect(h.rows.size).toBe(0);
        });
    });
});

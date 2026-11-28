import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));

import { seedUser } from '../testing/seed.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import searchRoute from './routes/search.route.js';

describeDb('GET /search/read', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let token: string;

    const read = (query: Record<string, string>, headers = { authorization: 'Bearer ' + token }) => app.inject({ url: '/search/read', query, headers });

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(searchRoute);
        await app.ready();

        const id = await seedUser(ctx.world().db, 'erin');
        token = app.jwt.sign({ sub: id, email: 'x@example.test' } as never);
    });

    afterAll(() => app.close());

    it('answers the query with what it read, counted from the given day', async () => {
        const response = await read({ q: 'receipts last month', today: '2027-01-15' });

        expect(response.statusCode, response.body).toBe(200);
        expect(response.json()).toEqual({
            q: 'receipts last month type:receipt date:2026-12-01..2026-12-31 read:"type:receipt receipts" read:"date:2026-12-01..2026-12-31 last month"',
        });
    });

    it('needs the user’s date', async () => {
        expect((await read({ q: 'receipts' })).statusCode).toBe(400);
        expect((await read({ q: 'receipts', today: 'today' })).statusCode).toBe(400);
    });

    it('needs a signed-in user', async () => {
        expect((await read({ q: 'receipts', today: '2027-01-15' }, { authorization: '' })).statusCode).toBe(401);
    });
});

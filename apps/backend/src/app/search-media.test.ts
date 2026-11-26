import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../services/storage.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/storage.service')>()),
    getStorageService: () => ({ getFileUrl: async (path: string) => path, getThumbnailUrl: async (path: string) => path }),
}));

import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import searchRoute from './routes/search.route.js';

interface Found {
    results: Array<{ type?: string; filename?: string }>;
    total: number;
    facets: { formats: Array<{ name: string; count: number }> };
}

describeDb('search narrowed to photos and videos', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let erin: string;

    async function get(url: string): Promise<Found> {
        const response = await app.inject({
            url,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: erin, email: 'x@example.test' } as never) },
        });

        expect(response.statusCode, url + ' ' + response.body).toBe(200);

        return JSON.parse(response.body) as Found;
    }

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(searchRoute);
        await app.ready();

        const { db } = ctx.world();
        erin = await seedUser(db, 'erin');
        await seedFolder(db, erin, 'holiday');
        const holiday = (name: string, mime: string) => seedDocument(db, { userId: erin, name, mime, ocrText: 'holiday' });
        await holiday('holiday-beach.jpg', 'image/jpeg');
        await holiday('holiday-ferry.mp4', 'video/mp4');
        await holiday('holiday-booking.pdf', 'application/pdf');
    }, 60_000);
    afterAll(() => app.close());

    it('finds every file and the folder without the flag', async () => {
        const found = await get('/search?q=holiday&limit=100');

        expect(found.total).toBe(4);
    });

    it('finds only photos and videos with media=true, and no folder', async () => {
        const found = await get('/search?q=holiday&limit=100&media=true');

        expect(found.results.map((r) => r.filename).sort()).toEqual(['holiday-beach.jpg', 'holiday-ferry.mp4']);
        expect(found.total).toBe(2);
    });

    it('counts only photos and videos in the facets with media=true', async () => {
        const { facets } = await get('/search/facets?q=holiday&media=true');

        expect(facets.formats.map((facet) => facet.name).sort()).toEqual(['jpg', 'mp4']);
    });
});

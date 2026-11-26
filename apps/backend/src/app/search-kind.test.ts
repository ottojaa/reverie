import sensible from '@fastify/sensible';
import type { DocumentKind } from '@reverie/shared';
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

interface Facet {
    name: string;
    count: number;
}

interface Facets {
    types: Facet[];
    formats: Facet[];
}

interface Found {
    results: Array<{ filename?: string }>;
    total: number;
    facets: Facets;
}

/** What each kind's scope finds. A video filed as a photo, or a PDF filed under "other", is also what the `photo` type counts. */
const SCOPES: Array<{ kind: DocumentKind; names: string[]; types: string[]; formats: string[] }> = [
    { kind: 'image', names: ['holiday-beach.jpg'], types: ['photo'], formats: ['jpg'] },
    { kind: 'video', names: ['holiday-drone.mp4', 'holiday-ferry.mp4'], types: ['video'], formats: ['mp4'] },
    { kind: 'file', names: ['holiday-booking.pdf', 'holiday-leftover.pdf'], types: ['document'], formats: ['pdf'] },
];

describeDb('search narrowed to one kind', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let erin: string;

    async function get<T = Found>(url: string): Promise<T> {
        const response = await app.inject({
            url,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: erin, email: 'x@example.test' } as never) },
        });

        expect(response.statusCode, url + ' ' + response.body).toBe(200);

        return JSON.parse(response.body) as T;
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
        const secret = await seedFolder(db, erin, 'secret', { isPrivate: true });
        const holiday = (name: string, mime: string, category: string, folderId?: string) =>
            seedDocument(db, { userId: erin, name, mime, category, folderId, ocrText: 'holiday' });
        await holiday('holiday-beach.jpg', 'image/jpeg', 'photo');
        await holiday('holiday-ferry.mp4', 'video/mp4', 'video');
        await holiday('holiday-drone.mp4', 'video/mp4', 'photo');
        await holiday('holiday-booking.pdf', 'application/pdf', 'invoice');
        await holiday('holiday-leftover.pdf', 'application/pdf', 'other');
        await holiday('holiday-secret.jpg', 'image/jpeg', 'photo', secret.id);
        await holiday('holiday-secret.mp4', 'video/mp4', 'video', secret.id);
        await holiday('holiday-secret.pdf', 'application/pdf', 'invoice', secret.id);
    }, 60_000);
    afterAll(() => app.close());

    it.each(SCOPES)('finds and counts only the $kind documents outside private folders', async ({ kind, names }) => {
        const found = await get(`/search?q=holiday&limit=100&kind=${kind}`);

        expect(found.results.map((r) => r.filename).sort()).toEqual(names);
        expect(found.total).toBe(names.length);
    });

    it.each(SCOPES)('keeps both sets of $kind facets to the scope', async ({ kind, names, types, formats }) => {
        const withResults = await get(`/search?q=holiday&limit=100&kind=${kind}`);
        const alone = await get(`/search/facets?q=holiday&kind=${kind}`);

        for (const facets of [withResults.facets, alone.facets]) {
            expect(facets.types.map((facet) => facet.name)).toEqual(types);
            expect(facets.formats.map((facet) => facet.name)).toEqual(formats);
            expect(facets.formats.reduce((sum, facet) => sum + facet.count, 0)).toBe(names.length);
        }
    });

    it.each(SCOPES)('offers the $kind filter options before anything is typed', async ({ kind, types }) => {
        const { facets } = await get(`/search/facets?q=&kind=${kind}`);

        expect(facets.types.map((facet) => facet.name)).toEqual(types);
    });

    it.each(['photo', 'screenshot', 'video'])('does not offer %s to a file search, even when the query already asks for it', async (type) => {
        const { facets } = await get(`/search/facets?q=type%3A${type}&kind=file`);

        expect(facets.types.map((facet) => facet.name)).not.toContain(type);
    });

    it('rejects an unknown kind', async () => {
        const response = await app.inject({
            url: '/search?q=holiday&kind=music',
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: erin, email: 'x@example.test' } as never) },
        });

        expect(response.statusCode).toBe(400);
    });
});

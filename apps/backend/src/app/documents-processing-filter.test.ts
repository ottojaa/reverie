import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { seedDocument } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';

describeDb('GET /documents?processing', () => {
    const ctx = useWorld();
    let app: FastifyInstance;

    const world = (): World => ctx.world();

    async function list(query: string, userId = world().alice) {
        const response = await app.inject({
            method: 'GET',
            url: '/documents' + query,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: userId, email: 'x@example.test' } as never) },
        });
        const body = JSON.parse(response.body) as { items: Array<{ id: string; original_filename: string }>; total: number };

        return { status: response.statusCode, names: body.items?.map((d) => d.original_filename), total: body.total };
    }

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(documentsRoute);
        await app.ready();

        const { db, alice, bob, folders } = world();
        const mine = (name: string, statuses: NonNullable<Parameters<typeof seedDocument>[1]['statuses']>, extra = {}) =>
            seedDocument(db, { userId: alice, name, statuses, ...extra });

        await mine('p-ocr-pending.pdf', { ocr: 'pending' });
        await mine('p-thumb-processing.jpg', { thumbnail: 'processing' });
        await mine('p-llm-pending.pdf', { llm: 'pending' }, { folderId: folders.work.id });
        await mine('p-failed-and-skipped.pdf', { ocr: 'failed', thumbnail: 'skipped', llm: 'failed' });
        await mine('p-transcoding-only.mp4', {}, { transcodeStatus: 'processing' });
        await mine('p-trashed.pdf', { ocr: 'pending' }, { deleted: true });
        await mine('p-in-private-folder.pdf', { ocr: 'pending' }, { folderId: folders.vault.id });
        await seedDocument(db, { userId: bob, name: 'p-bobs.pdf', statuses: { ocr: 'pending' } });
    }, 60_000);
    afterAll(() => app.close());

    it('lists only documents with a pending or running text recognition, thumbnail or AI summary, with a matching total', async () => {
        const { status, names, total } = await list('?processing=true');

        expect(status).toBe(200);
        expect([...(names ?? [])].sort()).toEqual(['p-llm-pending.pdf', 'p-ocr-pending.pdf', 'p-thumb-processing.jpg']);
        expect(total).toBe(3);
    });

    it('makes total the processing total, not the page size', async () => {
        const { names, total } = await list('?processing=true&limit=1');

        expect(names).toHaveLength(1);
        expect(total).toBe(3);
    });

    it('reads processing=false and processing=0 as not filtering', async () => {
        const everything = await list('?limit=100');

        for (const value of ['false', '0']) {
            const { names, total } = await list('?limit=100&processing=' + value);

            expect(total).toBe(everything.total);
            expect(names).toEqual(everything.names);
        }

        expect(everything.names).toContain('p-failed-and-skipped.pdf');
    });

    it('leaves the list as it was when processing is omitted', async () => {
        const { names, total } = await list('?limit=100');

        expect(names).toEqual(expect.arrayContaining(['p-ocr-pending.pdf', 'p-failed-and-skipped.pdf', 'p-transcoding-only.mp4', 'invoice-acme.pdf']));
        expect(names).not.toContain('p-trashed.pdf');
        expect(names).not.toContain('p-in-private-folder.pdf');
        expect(names).not.toContain('p-bobs.pdf');
        expect(total).toBe(names?.length);
    });

    it('keeps private-folder, trashed and other users documents out of the processing list', async () => {
        const { names } = await list('?processing=true&limit=100');

        expect(names).not.toContain('p-in-private-folder.pdf');
        expect(names).not.toContain('p-trashed.pdf');
        expect(names).not.toContain('p-bobs.pdf');
    });

    it('reads any other value as not filtering', async () => {
        const { status, total } = await list('?processing=banana');

        expect(status).toBe(200);
        expect(total).toBeGreaterThan(3);
    });
});

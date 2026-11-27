import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';

/** Names in the order `sort=name` lists them, shared with the Android app's tests; a group's names fold to one. */
const NAME_ORDER = JSON.parse(readFileSync(join(__dirname, '../../../../libs/shared/src/fixtures/name-order.json'), 'utf8')) as {
    ascending: string[][];
};

interface Item {
    id: string;
    original_filename: string;
    size_bytes: number;
    city?: string | null;
}

describeDb('GET /documents?sort', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let carol: string;
    let names: string;
    let sizes: string;
    let media: string;
    const nameGroups: string[][] = [];
    const sized: Array<{ id: string; size: number }> = [];

    async function get(query: string) {
        const response = await app.inject({
            method: 'GET',
            url: '/documents' + query,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: carol, email: 'x@example.test' } as never) },
        });
        const body = JSON.parse(response.body) as { items: Item[]; total: number };

        return { status: response.statusCode, items: body.items, total: body.total };
    }

    /** Every page of a listing, `limit` at a time. */
    async function readAll(query: string, limit: number): Promise<Item[]> {
        const items: Item[] = [];
        for (let offset = 0; ; offset += limit) {
            const page = await get(`${query}&limit=${limit}&offset=${offset}`);
            items.push(...page.items);
            if (offset + limit >= page.total) return items;
        }
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

        const { db } = ctx.world();
        carol = await seedUser(db, 'carol');
        names = (await seedFolder(db, carol, 'Names')).id;
        sizes = (await seedFolder(db, carol, 'Sizes')).id;
        media = (await seedFolder(db, carol, 'Media')).id;

        // Seeded last name first, so upload order cannot stand in for name order.
        for (const group of [...NAME_ORDER.ascending].reverse()) {
            const ids: string[] = [];
            for (const name of group) ids.push(await seedDocument(db, { userId: carol, name, folderId: names }));
            nameGroups.unshift([...ids].sort());
        }

        for (const size of [300, 5_000_000_000, 100, 300, 300, 500]) {
            sized.push({ id: await seedDocument(db, { userId: carol, name: `s${sized.length}.pdf`, sizeBytes: size, folderId: sizes }), size });
        }

        const at = (iso: string) => new Date(iso);
        await seedDocument(db, {
            userId: carol,
            name: 'b-old.jpg',
            mime: 'image/jpeg',
            folderId: media,
            createdAt: at('2026-01-01T00:00:00Z'),
            photo: { takenAt: at('2025-01-01T00:00:00Z'), city: 'Suomenlinna' },
        });
        await seedDocument(db, { userId: carol, name: 'c-new.mp4', mime: 'video/mp4', folderId: media, createdAt: at('2026-02-01T00:00:00Z') });
        await seedDocument(db, { userId: carol, name: 'a-doc.pdf', folderId: media, createdAt: at('2026-03-01T00:00:00Z') });
    }, 60_000);
    afterAll(() => app.close());

    it('sorts by name across pages, case-folded A-Z only and compared by bytes, ties by id', async () => {
        const items = await readAll(`?folder_id=${names}&sort=name`, 3);

        expect(items.map((d) => d.id)).toEqual(nameGroups.flat());
        expect(items.map((d) => d.original_filename).slice(0, 3)).toEqual(['10.jpg', '2.jpg', '_x.jpg']);
    });

    it('sorts by size across pages, largest first, ties by id descending', async () => {
        const items = await readAll(`?folder_id=${sizes}&sort=size`, 2);
        const expected = [...sized].sort((a, b) => b.size - a.size || (a.id < b.id ? 1 : -1));

        expect(items.map((d) => d.id)).toEqual(expected.map((d) => d.id));
    });

    it('applies the sort to a media listing too', async () => {
        const { items } = await get(`?folder_id=${media}&media=true&sort=name`);

        expect(items.map((d) => d.original_filename)).toEqual(['b-old.jpg', 'c-new.mp4']);
    });

    it('keeps the order it had when no sort is asked for', async () => {
        const all = await get(`?folder_id=${media}`);
        const mediaOnly = await get(`?folder_id=${media}&media=true`);

        expect(all.items.map((d) => d.original_filename)).toEqual(['a-doc.pdf', 'c-new.mp4', 'b-old.jpg']);
        expect(mediaOnly.items.map((d) => d.original_filename)).toEqual(['c-new.mp4', 'b-old.jpg']);
    });

    it('lists the city a photo was taken in, null where there is none', async () => {
        const { items } = await get(`?folder_id=${media}`);

        expect(items.map((d) => d.city)).toEqual([null, null, 'Suomenlinna']);
    });

    it('refuses a sort it does not know', async () => {
        const { status } = await get('?sort=date');

        expect(status).toBe(400);
    });
});

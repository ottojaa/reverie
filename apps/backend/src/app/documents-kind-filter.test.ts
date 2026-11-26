import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';

interface Listed {
    status: number;
    names: string[];
    total: number;
    items: Array<{ original_filename: string; taken_at?: string | null }>;
}

describeDb('GET /documents?kind', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let carol: string;
    let trips: string;

    const world = (): World => ctx.world();

    async function list(query: string, userId = carol): Promise<Listed> {
        const response = await app.inject({
            method: 'GET',
            url: '/documents' + query,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: userId, email: 'x@example.test' } as never) },
        });
        const body = JSON.parse(response.body) as { items: Listed['items']; total: number };

        return { status: response.statusCode, names: body.items?.map((d) => d.original_filename), total: body.total, items: body.items };
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

        const { db } = world();
        carol = await seedUser(db, 'carol');
        const trip = await seedFolder(db, carol, 'Trips');
        const vault = await seedFolder(db, carol, 'Vault', { isPrivate: true });
        trips = trip.id;
        const at = (iso: string) => new Date(iso);
        const photo = (name: string, takenAt: string | null, createdAt: string, extra: Partial<Parameters<typeof seedDocument>[1]> = {}) =>
            seedDocument(db, {
                userId: carol,
                name,
                mime: 'image/jpeg',
                createdAt: at(createdAt),
                photo: takenAt ? { takenAt: at(takenAt) } : undefined,
                ...extra,
            });

        // Uploaded in a different order than taken, so the two orders disagree.
        await photo('img-taken-nov.jpg', '2026-11-02T09:00:00Z', '2026-11-20T10:00:00Z');
        await photo('img-taken-oct.jpg', '2026-10-30T23:30:00Z', '2026-11-21T10:00:00Z', { folderId: trip.id });
        await photo('img-no-exif-uploaded-oct31.jpg', null, '2026-10-31T08:00:00Z');
        await photo('IMG-UPPER.JPG', '2026-09-01T00:00:00Z', '2026-11-22T10:00:00Z');
        // Same taken_at and created_at: the id decides, so paging never repeats or skips.
        for (const n of ['tie-a.jpg', 'tie-b.jpg', 'tie-c.jpg']) await photo(n, '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z');
        await seedDocument(db, {
            userId: carol,
            name: 'clip-taken-nov.mp4',
            mime: 'video/mp4',
            createdAt: at('2026-11-10T10:00:00Z'),
            photo: { takenAt: at('2026-11-05T12:00:00Z') },
        });
        await seedDocument(db, { userId: carol, name: 'clip-no-exif.mov', mime: 'video/quicktime', createdAt: at('2026-11-12T10:00:00Z') });
        await seedDocument(db, {
            userId: carol,
            name: 'clip-processing.mp4',
            mime: 'Video/MP4',
            createdAt: at('2026-11-13T10:00:00Z'),
            statuses: { thumbnail: 'processing' },
        });
        await seedDocument(db, { userId: carol, name: 'report.pdf', mime: 'application/pdf', createdAt: at('2026-11-15T10:00:00Z'), folderId: trip.id });
        await seedDocument(db, { userId: carol, name: 'song.mp3', mime: 'audio/mpeg', createdAt: at('2026-11-16T10:00:00Z') });
        await seedDocument(db, { userId: carol, name: 'mystery', mime: '', createdAt: at('2026-11-17T10:00:00Z') });
        await seedDocument(db, { userId: carol, name: 'vault.jpg', mime: 'image/jpeg', folderId: vault.id });
        await seedDocument(db, { userId: carol, name: 'trashed.jpg', mime: 'image/jpeg', deleted: true });
        await seedDocument(db, { userId: world().alice, name: 'alices.jpg', mime: 'image/jpeg' });
    }, 60_000);
    afterAll(() => app.close());

    it('lists only images with kind=image, case-insensitively, and totals them', async () => {
        const { names, total } = await list('?kind=image&limit=100');

        expect([...names].sort()).toEqual([
            'IMG-UPPER.JPG',
            'img-no-exif-uploaded-oct31.jpg',
            'img-taken-nov.jpg',
            'img-taken-oct.jpg',
            'tie-a.jpg',
            'tie-b.jpg',
            'tie-c.jpg',
        ]);
        expect(total).toBe(7);
    });

    it('lists only videos with kind=video', async () => {
        const { names, total } = await list('?kind=video&limit=100');

        expect([...names].sort()).toEqual(['clip-no-exif.mov', 'clip-processing.mp4', 'clip-taken-nov.mp4']);
        expect(total).toBe(3);
    });

    it('lists everything else, an empty mime type included, with kind=file', async () => {
        const { names, total } = await list('?kind=file&limit=100');

        expect([...names]).toEqual(['mystery', 'song.mp3', 'report.pdf']);
        expect(total).toBe(3);
    });

    it('keeps private-folder, trashed and other users documents out of every kind', async () => {
        for (const kind of ['image', 'video', 'file']) {
            const { names } = await list('?limit=100&kind=' + kind);

            expect(names).not.toContain('vault.jpg');
            expect(names).not.toContain('trashed.jpg');
            expect(names).not.toContain('alices.jpg');
        }
    });

    it('orders images by date taken, falling back to the upload date', async () => {
        const { names } = await list('?kind=image&limit=100');

        expect(names.slice(0, 4)).toEqual(['img-taken-nov.jpg', 'img-no-exif-uploaded-oct31.jpg', 'img-taken-oct.jpg', 'IMG-UPPER.JPG']);
    });

    it('orders videos by date taken, falling back to the upload date', async () => {
        const { names } = await list('?kind=video&limit=100');

        // Taken Nov 5 (uploaded Nov 10) sorts below the two videos without a capture time, which fall back to their Nov 12 and 13 uploads.
        expect(names).toEqual(['clip-processing.mp4', 'clip-no-exif.mov', 'clip-taken-nov.mp4']);
    });

    it('orders files, and the unfiltered list, by upload date', async () => {
        const { names: files } = await list('?kind=file&limit=100');
        const { names: all } = await list('?limit=100');

        expect(files).toEqual(['mystery', 'song.mp3', 'report.pdf']);
        expect(all.slice(0, 9)).toEqual([
            'IMG-UPPER.JPG',
            'img-taken-oct.jpg',
            'img-taken-nov.jpg',
            'mystery',
            'song.mp3',
            'report.pdf',
            'clip-processing.mp4',
            'clip-no-exif.mov',
            'clip-taken-nov.mp4',
        ]);
    });

    it('returns today’s list unchanged when kind is omitted', async () => {
        const { names, total } = await list('?limit=100');

        expect(total).toBe(13);
        expect(names).toHaveLength(13);
    });

    it('pages the date-taken order stably, ties included', async () => {
        const seen: string[] = [];

        for (let offset = 0; offset < 7; offset += 2) seen.push(...(await list('?kind=image&limit=2&offset=' + offset)).names);

        const full = (await list('?kind=image&limit=100')).names;

        expect(seen).toEqual(full);
        expect(new Set(seen).size).toBe(7);
    });

    it('composes with folder_id', async () => {
        const images = await list('?kind=image&folder_id=' + trips);
        const files = await list('?kind=file&folder_id=' + trips);

        expect(images.names).toEqual(['img-taken-oct.jpg']);
        expect(images.total).toBe(1);
        expect(files.names).toEqual(['report.pdf']);
        expect(files.total).toBe(1);
    });

    it('lists photos and videos together with media=true, by date taken else upload date', async () => {
        const { names, total } = await list('?media=true&limit=100');

        expect(total).toBe(10);
        expect(names.slice(0, 7)).toEqual([
            'clip-processing.mp4',
            'clip-no-exif.mov',
            'clip-taken-nov.mp4',
            'img-taken-nov.jpg',
            'img-no-exif-uploaded-oct31.jpg',
            'img-taken-oct.jpg',
            'IMG-UPPER.JPG',
        ]);
    });

    it('scopes media=true to a folder', async () => {
        const { names, total } = await list('?media=true&folder_id=' + trips);

        expect(names).toEqual(['img-taken-oct.jpg']);
        expect(total).toBe(1);
    });

    it('refuses media together with a kind', async () => {
        const { status } = await list('?media=true&kind=image');

        expect(status).toBe(400);
    });

    it('composes with processing', async () => {
        const videos = await list('?kind=video&processing=true');
        const images = await list('?kind=image&processing=true');

        expect(videos.names).toEqual(['clip-processing.mp4']);
        expect(videos.total).toBe(1);
        expect(images.total).toBe(0);
    });

    it('shows taken_at as the stored clock reading, null when there is none', async () => {
        const { items } = await list('?kind=image&limit=100');
        const byName = Object.fromEntries(items.map((d) => [d.original_filename, d.taken_at]));

        expect(byName['img-taken-oct.jpg']).toBe('2026-10-30T23:30:00.000Z');
        expect(byName['img-no-exif-uploaded-oct31.jpg']).toBeNull();
    });

    it('rejects an unknown kind', async () => {
        expect((await list('?kind=photo')).status).toBe(400);
    });
});

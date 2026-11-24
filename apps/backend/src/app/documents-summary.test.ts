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

interface Summary {
    image: { count: number; bytes: number };
    video: { count: number; bytes: number };
    file: { count: number; bytes: number; top_types: Array<{ ext: string; count: number }> };
}

describeDb('GET /documents/summary', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let carol: string;
    let trips: string;
    let vault: string;

    const world = (): World => ctx.world();

    async function summary(query = '', userId = carol): Promise<{ status: number; body: Summary }> {
        const response = await app.inject({
            method: 'GET',
            url: '/documents/summary' + query,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: userId, email: 'x@example.test' } as never) },
        });

        return { status: response.statusCode, body: JSON.parse(response.body) as Summary };
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
        trips = (await seedFolder(db, carol, 'Trips')).id;
        vault = (await seedFolder(db, carol, 'Vault', { isPrivate: true })).id;
        const doc = (name: string, mime: string, sizeBytes: number, extra: Partial<Parameters<typeof seedDocument>[1]> = {}) =>
            seedDocument(db, { userId: carol, name, mime, sizeBytes, ...extra });

        await doc('a.jpg', 'image/jpeg', 1000);
        await doc('b.JPG', 'Image/JPEG', 2000, { folderId: trips });
        await doc('c.png', 'image/png', 500);
        await doc('clip.mp4', 'video/mp4', 10_000);
        await doc('clip2.mov', 'VIDEO/QUICKTIME', 20_000, { folderId: trips });
        // Files: three apks, two zips, a pdf and a md in different cases, then one-offs; the top four are apk, zip, pdf, md.
        for (const n of ['one.apk', 'two.APK', 'three.apk']) await doc(n, 'application/vnd.android.package-archive', 100);
        for (const n of ['x.zip', 'y.ZIP']) await doc(n, 'application/zip', 300, { folderId: trips });
        await doc('report.pdf', 'application/pdf', 400);
        await doc('Report2.PDF', 'application/pdf', 400);
        await doc('notes.md', 'text/markdown', 50);
        await doc('readme.md', 'text/markdown', 50);
        await doc('tune.mp3', 'audio/mpeg', 5000);
        await doc('archive.tar.gz', 'application/gzip', 70);
        // No extension in the name: the MIME subtype stands in. No mime type either: it is left out of the top types.
        await doc('Makefile', 'text/x-makefile', 10);
        await doc('mystery', '', 10);
        // Never counted: private folder, trash, another user.
        await doc('vault.jpg', 'image/jpeg', 9_000_000, { folderId: vault });
        await doc('vault.pdf', 'application/pdf', 9_000_000, { folderId: vault });
        await doc('trashed.mp4', 'video/mp4', 9_000_000, { deleted: true });
        await seedDocument(db, { userId: world().alice, name: 'alices.jpg', mime: 'image/jpeg', sizeBytes: 9_000_000 });
    }, 60_000);
    afterAll(() => app.close());

    it('counts documents and sums bytes per kind, mime types matched case-insensitively', async () => {
        const { status, body } = await summary();

        expect(status).toBe(200);
        expect(body.image).toEqual({ count: 3, bytes: 3500 });
        expect(body.video).toEqual({ count: 2, bytes: 30_000 });
        expect(body.file.count).toBe(13);
        expect(body.file.bytes).toBe(300 + 600 + 800 + 100 + 5000 + 70 + 10 + 10);
    });

    it('lists the four most common file types, most common first, from the name or else the MIME subtype', async () => {
        const { body } = await summary();

        // apk 3, then pdf/zip/md at 2 each (ties by name); mp3, gz, makefile-less ones trail.
        expect(body.file.top_types).toEqual([
            { ext: 'apk', count: 3 },
            { ext: 'md', count: 2 },
            { ext: 'pdf', count: 2 },
            { ext: 'zip', count: 2 },
        ]);
    });

    it('falls back to the MIME subtype for a name with no extension, and skips files with neither', async () => {
        const { db } = world();
        const bare = (await seedFolder(db, carol, 'Bare')).id;

        await seedDocument(db, { userId: carol, name: 'Makefile', mime: 'text/x-makefile', folderId: bare });
        await seedDocument(db, { userId: carol, name: 'LICENSE', mime: 'Text/Plain', folderId: bare });
        await seedDocument(db, { userId: carol, name: 'NOTES', mime: 'text/plain', folderId: bare });
        await seedDocument(db, { userId: carol, name: 'mystery', mime: '', folderId: bare });

        const { body } = await summary('?folder_id=' + bare);

        expect(body.file.count).toBe(4);
        expect(body.file.top_types).toEqual([
            { ext: 'plain', count: 2 },
            { ext: 'x-makefile', count: 1 },
        ]);
    });

    it('scopes to a folder', async () => {
        const { body } = await summary('?folder_id=' + trips);

        expect(body.image).toEqual({ count: 1, bytes: 2000 });
        expect(body.video).toEqual({ count: 1, bytes: 20_000 });
        expect(body.file).toEqual({ count: 2, bytes: 600, top_types: [{ ext: 'zip', count: 2 }] });
    });

    it('reports zeros for an empty scope', async () => {
        const empty = await seedFolder(world().db, carol, 'Empty');
        const result = await summary('?folder_id=' + empty.id);

        expect(result.body).toEqual({ image: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 }, file: { count: 0, bytes: 0, top_types: [] } });
    });

    it('leaves private-folder, trashed and other users documents out', async () => {
        const { body } = await summary();

        expect(body.image.count).toBe(3);
        expect(body.video.count).toBe(2);
        expect(body.image.bytes + body.video.bytes + body.file.bytes).toBeLessThan(1_000_000);
    });

    it('refuses a locked private folder, like the list does', async () => {
        const { status } = await summary('?folder_id=' + vault);
        const listed = await app.inject({
            method: 'GET',
            url: '/documents?folder_id=' + vault,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: carol, email: 'x@example.test' } as never) },
        });

        expect(status).not.toBe(200);
        expect(status).toBe(listed.statusCode);
    });
});

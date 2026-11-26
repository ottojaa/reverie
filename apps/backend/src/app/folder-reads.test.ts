import sensible from '@fastify/sensible';
import type { FolderWithChildren, SearchResponse } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({
    env: {
        JWT_SECRET: 's'.repeat(32),
        JWT_ACCESS_EXPIRES: '15m',
        NODE_ENV: 'test',
        TRASH_RETENTION_DAYS: 30,
        STORAGE_PROVIDER: 's3',
    },
}));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/thumbnail.queue', () => ({ addThumbnailJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));
vi.mock('../services/storage.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/storage.service')>()),
    getStorageService: () => ({}),
}));

import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import multipartPlugin from './plugins/multipart.js';
import foldersRoute from './routes/folders.route.js';
import searchRoute from './routes/search.route.js';
import uploadRoute from './routes/upload.route.js';

const MISSING = '00000000-0000-4000-8000-000000000000';
const BOUNDARY = 'test-boundary';

function toMultipart(fields: { folderId?: string; hasFile: boolean }): string {
    const parts = [
        ...(fields.folderId ? ['Content-Disposition: form-data; name="folder_id"\r\n\r\n' + fields.folderId] : []),
        ...(fields.hasFile ? ['Content-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nhello'] : []),
    ];

    return parts.map((part) => '--' + BOUNDARY + '\r\n' + part + '\r\n').join('') + '--' + BOUNDARY + '--\r\n';
}

describeDb('reading and filing into folders', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let dana: string;
    const ids = { papers: '', binned: '' };

    const authorization = () => 'Bearer ' + app.jwt.sign({ sub: dana, email: 'x@example.test' } as never);
    const get = (url: string) => app.inject({ method: 'GET', url, headers: { authorization: authorization() } });
    const upload = (fields: { folderId?: string; hasFile: boolean }) =>
        app.inject({
            method: 'POST',
            url: '/upload',
            headers: { authorization: authorization(), 'content-type': 'multipart/form-data; boundary=' + BOUNDARY },
            payload: toMultipart(fields),
        });

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(multipartPlugin);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(foldersRoute);
        await app.register(searchRoute);
        await app.register(uploadRoute);
        await app.ready();

        const { db } = ctx.world();

        dana = await seedUser(db, 'dana-folder-reads');

        const papers = await seedFolder(db, dana, 'Papers');
        const bills = await seedFolder(db, dana, 'Bills', { parent: papers });
        const diary = await seedFolder(db, dana, 'Diary', { parent: papers, isPrivate: true });
        const binned = await seedFolder(db, dana, 'Binned', { deleted: true });
        const holdings = [
            { folderId: papers.id, names: ['own.pdf', 'own.jpg'] },
            { folderId: bills.id, names: ['bill.pdf', 'scan.jpg', 'clip.mp4'] },
            { folderId: diary.id, names: ['one.pdf', 'two.pdf', 'three.jpg', 'four.mp4'] },
        ];
        const mimes: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', mp4: 'video/mp4' };

        for (const { folderId, names } of holdings) {
            for (const name of names) await seedDocument(db, { userId: dana, name, folderId, mime: mimes[name.split('.')[1]!] });
        }

        // In the trash, so it counts nowhere.
        await seedDocument(db, { userId: dana, name: 'gone.pdf', folderId: bills.id, deleted: true });
        Object.assign(ids, { papers: papers.id, binned: binned.id });
    });
    afterAll(() => app.close());

    it('counts a folder search hit like the folder tree: public subfolders in, private ones out', async () => {
        const search = (await get('/search?q=Papers')).json<SearchResponse>();
        const hit = search.results.find((result) => result.result_type === 'collection' && result.id === ids.papers);
        const node = (await get('/folders/tree')).json<FolderWithChildren[]>().find((folder) => folder.id === ids.papers)!;
        const fromTree = node.kind_counts.image + node.kind_counts.video + node.kind_counts.file;

        expect(hit).toMatchObject({ document_count: 5 });
        expect(fromTree).toBe(5);
    });

    it.each([
        ['missing', () => MISSING],
        ['trashed', () => ids.binned],
    ])('answers 404 with a reason when asked for a %s folder', async (_label, folderId) => {
        const response = await get('/folders/' + folderId());

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ error: 'NOT_FOUND', message: expect.stringContaining('Folder') });
    });

    it.each([
        ['missing', () => MISSING],
        ['trashed', () => ids.binned],
    ])('answers 404 with a reason to an upload into a %s folder', async (_label, folderId) => {
        const response = await upload({ folderId: folderId(), hasFile: true });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ error: 'NOT_FOUND', message: expect.stringContaining('Folder') });
    });

    it('answers 400 with a reason to an upload with no files', async () => {
        const response = await upload({ hasFile: false });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR', message: expect.stringContaining('No files') });
    });
});

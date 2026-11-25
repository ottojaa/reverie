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
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import foldersRoute from './routes/folders.route.js';
import trashRoute from './routes/trash.route.js';

describeDb('folder writes over HTTP, three levels deep', () => {
    const ctx = useWorld();
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(foldersRoute);
        await app.register(trashRoute);
        await app.ready();
    }, 60_000);
    afterAll(() => app.close());

    async function request(userId: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
        const authorization = 'Bearer ' + app.jwt.sign({ sub: userId, email: 'x@example.test' } as never);
        const response = await app.inject({ method, url, payload, headers: { authorization } });

        return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
    }

    const fetchFolders = (userId: string) => ctx.world().db.selectFrom('folders').selectAll().where('user_id', '=', userId).orderBy('path').execute();
    const fetchDocuments = (userId: string) =>
        ctx.world().db.selectFrom('documents').selectAll().where('user_id', '=', userId).orderBy('original_filename').execute();

    it('puts each new top-level folder behind the ones already there', async () => {
        const erin = await seedUser(ctx.world().db, 'erin-order');
        const first = await request(erin, 'POST', '/folders', { name: 'First' });
        const second = await request(erin, 'POST', '/folders', { name: 'Second' });

        expect([first.body.sort_order, second.body.sort_order]).toEqual([0, 1]);
    });

    it('renames and moves in one call, re-pathing everything beneath', async () => {
        const { db } = ctx.world();
        const frank = await seedUser(db, 'frank-move');
        const old = await seedFolder(db, frank, 'Old');
        const mover = await seedFolder(db, frank, 'Mover', { parent: old });
        const middle = await seedFolder(db, frank, 'Middle', { parent: mover });
        const leaf = await seedFolder(db, frank, 'Leaf', { parent: middle });
        const target = await seedFolder(db, frank, 'Target');

        const moved = await request(frank, 'PATCH', '/folders/' + mover.id, { name: 'Renamed', parent_id: target.id });

        expect(moved.body).toMatchObject({ name: 'Renamed', parent_id: target.id, path: '/Target/Renamed' });
        expect((await request(frank, 'GET', '/folders/' + leaf.id)).body.path).toBe('/Target/Renamed/Middle/Leaf');
    });

    /** Travel holds files two and three levels down, a private folder with files, and one file trashed before. */
    async function seedTravel(userId: string) {
        const { db } = ctx.world();
        const travel = await seedFolder(db, userId, 'Travel');
        const year = await seedFolder(db, userId, 'Year', { parent: travel });
        const month = await seedFolder(db, userId, 'Month', { parent: year });
        const diary = await seedFolder(db, userId, 'Diary', { parent: travel, isPrivate: true });
        const pages = await seedFolder(db, userId, 'Pages', { parent: diary });
        const files = { 'a.pdf': year, 'b.pdf': month, 'c.pdf': month, 'earlier.pdf': month, 'secret.pdf': diary, 'sheet.pdf': pages };

        for (const [name, folder] of Object.entries(files)) await seedDocument(db, { userId, name, folderId: folder.id });

        await db
            .updateTable('documents')
            .set({ deleted_at: new Date('2026-01-01T00:00:00Z') })
            .where('user_id', '=', userId)
            .where('original_filename', '=', 'earlier.pdf')
            .execute();

        return travel;
    }

    it('trashes a folder with everything beneath it as one entry, and restores it all in place', async () => {
        const gina = await seedUser(ctx.world().db, 'gina-trash');
        const travel = await seedTravel(gina);
        const placed = (await fetchDocuments(gina)).map((doc) => [doc.original_filename, doc.folder_id]);

        expect((await request(gina, 'DELETE', '/folders/' + travel.id)).status).toBe(204);

        const rows = [...(await fetchFolders(gina)), ...(await fetchDocuments(gina)).filter((doc) => doc.original_filename !== 'earlier.pdf')];

        expect(rows).toHaveLength(10);
        expect(new Set(rows.map((row) => row.deleted_at?.getTime())).size).toBe(1);

        const trash = (await request(gina, 'GET', '/trash')).body;

        // Folders: Year, Month and the private Diary. Documents: a, b and c; nothing inside Diary is counted.
        expect(trash.folders).toEqual([expect.objectContaining({ id: travel.id, name: 'Travel', folder_count: 3, document_count: 3 })]);
        expect(trash.documents.map((doc: { original_filename: string }) => doc.original_filename)).toEqual(['earlier.pdf']);

        // A live folder takes the name while the old one is in the trash.
        expect((await request(gina, 'POST', '/folders', { name: 'Travel' })).status).toBe(201);
        expect((await request(gina, 'POST', '/trash/restore', { folder_ids: [travel.id] })).status).toBe(200);

        const restored = (await fetchFolders(gina)).map((folder) => [folder.path, folder.deleted_at]);
        const documents = await fetchDocuments(gina);

        expect(restored).toEqual(
            [
                '/Travel',
                '/Travel (restored)',
                '/Travel (restored)/Diary',
                '/Travel (restored)/Diary/Pages',
                '/Travel (restored)/Year',
                '/Travel (restored)/Year/Month',
            ].map((path) => [path, null]),
        );
        expect(documents.map((doc) => [doc.original_filename, doc.folder_id])).toEqual(placed);
        expect(documents.filter((doc) => doc.deleted_at !== null).map((doc) => doc.original_filename)).toEqual(['earlier.pdf']);
    });
});

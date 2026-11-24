import sensible from '@fastify/sensible';
import type { Favourite } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));
vi.mock('../services/storage.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/storage.service')>()),
    getStorageService: () => ({
        getFileUrl: async (path: string) => 'https://files.test/signed' + path,
        getThumbnailUrl: async (path: string) => 'https://files.test/thumbnail' + path,
    }),
}));

import { getFolderService } from '../services/folder.service.js';
import { getTrashService } from '../services/trash.service.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import favouritesRoute from './routes/favourites.route.js';

type Type = 'document' | 'folder';

const MISSING = '00000000-0000-4000-8000-000000000000';

describeDb('favourites', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let dana: string;
    let eve: string;
    const ids: Record<string, string> = {};

    const world = (): World => ctx.world();

    function headers(userId: string, openLocks: string[]) {
        const vault = app.jwt.sign({ sub: userId, scope: 'vault', locks: openLocks } as never);

        return { authorization: 'Bearer ' + app.jwt.sign({ sub: userId, email: 'x@example.test' } as never), cookie: 'vault_session=' + vault };
    }

    async function set(type: Type, id: string, isFavourite: boolean, options: { openLocks?: string[]; as?: string } = {}) {
        const response = await app.inject({
            method: 'PUT',
            url: `/favourites/${type}/${id}`,
            headers: headers(options.as ?? dana, options.openLocks ?? []),
            payload: { is_favourite: isFavourite },
        });

        return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
    }

    const star = (type: Type, id: string, openLocks: string[] = []) => set(type, id, true, { openLocks });
    const unstar = (type: Type, id: string, openLocks: string[] = []) => set(type, id, false, { openLocks });

    async function fetchList(openLocks: string[] = []): Promise<{ raw: string; items: Favourite[] }> {
        const response = await app.inject({ method: 'GET', url: '/favourites', headers: headers(dana, openLocks) });

        expect(response.statusCode).toBe(200);

        return { raw: response.body, items: (JSON.parse(response.body) as { items: Favourite[] }).items };
    }

    const listedIds = async () => (await fetchList()).items.map((item) => item.id);
    const countRows = async () => (await world().db.selectFrom('favourites').select('id').where('user_id', '=', dana).execute()).length;

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(favouritesRoute);
        await app.ready();

        const { db } = world();

        dana = await seedUser(db, 'dana-favourites');
        eve = await seedUser(db, 'eve-favourites');

        const trips = await seedFolder(db, dana, 'Trips');
        const rome = await seedFolder(db, dana, 'Rome', { parent: trips });
        const vault = await seedFolder(db, dana, 'PLANTEDVAULT', { isPrivate: true });
        const inner = await seedFolder(db, dana, 'PLANTEDINNER', { parent: vault });
        const doc = (name: string, folderId: string | null) =>
            seedDocument(db, { userId: dana, name, folderId, mime: 'image/jpeg', blurhash: 'PLANTEDBLURHASH' });

        Object.assign(ids, { trips: trips.id, rome: rome.id, vault: vault.id, inner: inner.id });
        ids.photo = await doc('colosseum.jpg', rome.id);
        ids.loose = await doc('loose.jpg', null);
        ids.secret = await doc('PLANTEDSECRET.jpg', inner.id);
        await db
            .updateTable('documents')
            .set({ thumbnail_paths: JSON.stringify({ sm: '/PLANTEDSM', md: '/PLANTEDMD', lg: '/PLANTEDLG' }) as never })
            .where('id', '=', ids.secret)
            .execute();
    });
    afterAll(() => app.close());
    beforeEach(async () => {
        await world().db.deleteFrom('favourites').execute();
    });

    it('stars and unstars a document and a folder', async () => {
        expect((await star('document', ids.photo!)).status).toBe(204);
        expect((await star('folder', ids.rome!)).status).toBe(204);
        expect(await listedIds()).toEqual([ids.rome, ids.photo]);

        expect((await unstar('document', ids.photo!)).status).toBe(204);
        expect((await unstar('folder', ids.rome!)).status).toBe(204);
        expect(await listedIds()).toEqual([]);
    });

    it('keeps the first starred_at when an item is starred again', async () => {
        await star('document', ids.photo!);
        await world()
            .db.updateTable('favourites')
            .set({ starred_at: new Date('2026-01-01T00:00:00Z') } as never)
            .execute();

        expect((await star('document', ids.photo!)).status).toBe(204);

        expect((await fetchList()).items.map((item) => item.starred_at)).toEqual(['2026-01-01T00:00:00.000Z']);
    });

    it('answers 204 when unstarring something never starred, or not there at all', async () => {
        expect((await unstar('document', ids.photo!)).status).toBe(204);
        expect((await unstar('folder', MISSING)).status).toBe(204);
    });

    it("answers the same 404 for a missing, trashed and another user's item", async () => {
        const { db } = world();
        const trashed = await seedDocument(db, { userId: dana, name: 'gone.pdf', deleted: true });
        const trashedFolder = await seedFolder(db, dana, 'Gone', { deleted: true });
        const theirs = await seedDocument(db, { userId: eve, name: 'theirs.pdf' });
        const theirFolder = await seedFolder(db, eve, 'TheirFolder', { isPrivate: true });

        for (const [type, id] of [
            ['document', MISSING],
            ['document', trashed],
            ['document', theirs],
            ['folder', MISSING],
            ['folder', trashedFolder.id],
            ['folder', theirFolder.id],
        ] as const) {
            const { status, body } = await star(type, id);

            expect({ type, id, status, error: body.error }).toEqual({ type, id, status: 404, error: 'NOT_FOUND' });
        }

        expect(await countRows()).toBe(0);
    });

    it("leaves another user's star alone", async () => {
        const { db } = world();
        const theirs = await seedDocument(db, { userId: eve, name: 'kept.pdf' });

        await set('document', theirs, true, { as: eve });
        await unstar('document', theirs);

        expect(await db.selectFrom('favourites').select('document_id').where('user_id', '=', eve).execute()).toEqual([{ document_id: theirs }]);
    });

    it('refuses a closed lock in both directions, with the folder id', async () => {
        for (const [type, id, folderId] of [
            ['folder', ids.vault!, ids.vault!],
            ['folder', ids.inner!, ids.inner!],
            ['document', ids.secret!, ids.inner!],
        ] as const) {
            for (const isFavourite of [true, false]) {
                const { status, body } = await set(type, id, isFavourite);

                expect({ status, error: body.error, details: body.details }).toEqual({ status: 403, error: 'FOLDER_LOCKED', details: { folder_id: folderId } });
            }
        }

        expect(await countRows()).toBe(0);
    });

    it('allows both directions once the lock is open', async () => {
        const open = [ids.vault!];

        expect((await star('folder', ids.vault!, open)).status).toBe(204);
        expect((await star('document', ids.secret!, open)).status).toBe(204);
        expect(await countRows()).toBe(2);

        expect((await unstar('folder', ids.vault!, open)).status).toBe(204);
        expect((await unstar('document', ids.secret!, open)).status).toBe(204);
        expect(await countRows()).toBe(0);
    });

    it('lists newest-starred first', async () => {
        await star('folder', ids.trips!);
        await star('document', ids.loose!);
        await star('folder', ids.rome!);

        const { items } = await fetchList();

        expect(items.map((item) => item.id)).toEqual([ids.rome, ids.loose, ids.trips]);
        expect([...items].sort((a, b) => b.starred_at.localeCompare(a.starred_at))).toEqual(items);
    });

    it('describes public items with their payload and chain of parents', async () => {
        await star('folder', ids.trips!);
        await star('folder', ids.rome!);
        await star('document', ids.photo!);
        await star('document', ids.loose!);

        const byId = new Map((await fetchList()).items.map((item) => [item.id, item]));
        const trips = { id: ids.trips, name: 'Trips' };
        const rome = { id: ids.rome, name: 'Rome' };

        expect(byId.get(ids.trips!)?.location).toEqual([]);
        expect(byId.get(ids.rome!)?.location).toEqual([trips]);
        expect(byId.get(ids.photo!)?.location).toEqual([trips, rome]);
        expect(byId.get(ids.loose!)?.location).toEqual([]);
        expect(byId.get(ids.rome!)).toMatchObject({ type: 'folder', private: false, locked: false, lock_id: null, document: null });
        expect(byId.get(ids.rome!)?.folder).toMatchObject({ name: 'Rome', document_count: 1, locked: false });
        expect(byId.get(ids.rome!)?.folder?.cover?.tiles.map((tile) => tile.document_id)).toEqual([ids.photo]);
        expect(byId.get(ids.trips!)?.folder?.cover).toBeNull();
        expect(byId.get(ids.photo!)).toMatchObject({ type: 'document', private: false, folder: null });
        expect(byId.get(ids.photo!)?.document).toMatchObject({
            original_filename: 'colosseum.jpg',
            file_url: 'https://files.test/signed/files/colosseum.jpg',
            is_private: false,
        });
    });

    it('keeps a private item anonymous, locked and unlocked', async () => {
        await star('folder', ids.vault!, [ids.vault!]);
        await star('folder', ids.inner!, [ids.vault!]);
        await star('document', ids.secret!, [ids.vault!]);

        for (const openLocks of [[], [ids.vault!]]) {
            const { raw, items } = await fetchList(openLocks);

            expect(raw).not.toMatch(/PLANTED|\/thumbnail|files\.test/);
            expect(items.map((item) => item.id)).toEqual([ids.secret, ids.inner, ids.vault]);

            for (const item of items) {
                expect(item).toEqual({
                    type: item.type,
                    id: item.id,
                    starred_at: item.starred_at,
                    private: true,
                    locked: openLocks.length === 0,
                    lock_id: ids.vault,
                    location: null,
                    folder: null,
                    document: null,
                });
            }
        }
    });

    it('hides a trashed document and shows it again once restored', async () => {
        await star('document', ids.photo!);
        await getTrashService().trashDocuments(dana, [ids.photo!]);

        expect(await listedIds()).toEqual([]);
        expect(await countRows()).toBe(1);

        await getTrashService().restoreDocuments(dana, [ids.photo!]);

        expect(await listedIds()).toEqual([ids.photo]);
    });

    it('hides a trashed folder, and what was trashed with it, until it is restored', async () => {
        const { db } = world();
        const box = await seedFolder(db, dana, 'Box', { isPrivate: true });
        const kept = await seedDocument(db, { userId: dana, name: 'kept.pdf', folderId: box.id });

        await star('folder', box.id, [box.id]);
        await star('document', kept, [box.id]);
        await getFolderService().deleteFolder(box.id, dana);

        expect(await listedIds()).toEqual([]);

        await getTrashService().restore(dana, { folderIds: [box.id] });

        expect(await listedIds()).toEqual([kept, box.id]);
    });

    it('drops the star when its item is purged', async () => {
        const { db } = world();
        const file = await seedDocument(db, { userId: dana, name: 'purge-me.pdf' });
        const folder = await seedFolder(db, dana, 'PurgeMe');

        await star('document', file);
        await star('folder', folder.id);
        await getTrashService().trashDocuments(dana, [file]);
        await getFolderService().deleteFolder(folder.id, dana);
        await getTrashService().purge(dana, { documentIds: [file], folderIds: [folder.id] });

        expect(await countRows()).toBe(0);
    });
});

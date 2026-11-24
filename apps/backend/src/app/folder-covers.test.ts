import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));
vi.mock('../services/document-summary', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/document-summary')>();

    return { ...actual, loadFolderCovers: vi.fn(actual.loadFolderCovers) };
});

import { loadFolderCovers, summariseDocuments } from '../services/document-summary.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import foldersRoute from './routes/folders.route.js';

interface Node {
    id: string;
    type: 'collection' | 'folder';
    locked: boolean;
    document_count: number;
    children: Node[];
    cover: { tiles: Array<{ document_id: string; original_filename: string; thumbnail_blurhash: string | null }>; summary: unknown } | null;
}

const day = (n: number) => new Date('2026-01-' + String(n).padStart(2, '0') + 'T12:00:00Z');

describeDb('GET /folders/tree covers', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let carol: string;
    const ids: Record<string, string> = {};

    const world = (): World => ctx.world();

    /** The tree as carol sees it, with the given private folders opened (the vault_session cookie carries the open locks). */
    async function tree(openLocks: string[] = []): Promise<Node[]> {
        const vault = app.jwt.sign({ sub: carol, scope: 'vault', locks: openLocks } as never);
        const response = await app.inject({
            method: 'GET',
            url: '/folders/tree',
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: carol, email: 'x@example.test' } as never), cookie: 'vault_session=' + vault },
        });

        return JSON.parse(response.body) as Node[];
    }

    const find = (nodes: Node[], id: string): Node | undefined => nodes.flatMap((node) => [node, ...node.children]).find((node) => node.id === id);

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(foldersRoute);
        await app.ready();

        const { db } = world();

        carol = await seedUser(db, 'carol-covers');

        const trips = await seedFolder(db, carol, 'Trips');
        const rome = await seedFolder(db, carol, 'Rome', { parent: trips });
        const empty = await seedFolder(db, carol, 'Nothing', { parent: trips });
        const vault = await seedFolder(db, carol, 'Vault', { isPrivate: true });
        const secret = await seedFolder(db, carol, 'Secret', { parent: vault });
        const doc = (name: string, folderId: string, extra: Partial<Parameters<typeof seedDocument>[1]> = {}) =>
            seedDocument(db, { userId: carol, name, folderId, ...extra });

        Object.assign(ids, { trips: trips.id, rome: rome.id, empty: empty.id, vault: vault.id, secret: secret.id });
        // Newest first would be e (day 5), but only b, c and d have a thumbnail, so they lead.
        ids.a = await doc('a.jpg', rome.id, { mime: 'image/jpeg', createdAt: day(1), blurhash: 'LKO2?U%2Tw=w' });
        ids.b = await doc('b.jpg', rome.id, { mime: 'image/jpeg', createdAt: day(2), blurhash: 'LKO2?U%2Tw=w' });
        ids.c = await doc('c.jpg', rome.id, { mime: 'image/jpeg', createdAt: day(3), blurhash: 'LKO2?U%2Tw=w' });
        ids.d = await doc('d.jpg', rome.id, { mime: 'image/jpeg', createdAt: day(4), blurhash: 'LKO2?U%2Tw=w' });
        ids.e = await doc('e.pdf', rome.id, { createdAt: day(5) });
        ids.blank = await doc('blank.png', rome.id, { mime: 'image/png', createdAt: day(6), blurhash: '   ' });
        ids.trashed = await doc('trashed.jpg', rome.id, { mime: 'image/jpeg', createdAt: day(7), blurhash: 'LKO2?U%2Tw=w', deleted: true });
        ids.inSecret = await doc('inside-secret.pdf', secret.id, { createdAt: day(1) });
    });
    afterAll(() => app.close());

    it('orders tiles thumbnailed first, then newest, and stops at four', async () => {
        const cover = find(await tree(), ids.rome as string)?.cover;

        expect(cover?.tiles.map((tile) => tile.original_filename)).toEqual(['d.jpg', 'c.jpg', 'b.jpg', 'a.jpg']);
        expect(cover?.tiles.every((tile) => tile.thumbnail_blurhash !== null)).toBe(true);
    });

    it('puts unthumbnailed documents after the thumbnailed ones, newest first, and reads a blank blurhash as none', async () => {
        const { db } = world();
        const lonely = await seedFolder(db, carol, 'Lonely', { parent: { id: ids.trips as string, path: '/Trips' } });

        await seedDocument(db, { userId: carol, name: 'old.pdf', folderId: lonely.id, createdAt: day(1) });
        await seedDocument(db, { userId: carol, name: 'new.png', folderId: lonely.id, mime: 'image/png', createdAt: day(9), blurhash: ' ' });
        await seedDocument(db, { userId: carol, name: 'shot.jpg', folderId: lonely.id, mime: 'image/jpeg', createdAt: day(2), blurhash: 'LKO2?U%2Tw=w' });

        const tiles = find(await tree(), lonely.id)?.cover?.tiles ?? [];

        expect(tiles.map((tile) => tile.original_filename)).toEqual(['shot.jpg', 'new.png', 'old.pdf']);
        expect(tiles.map((tile) => tile.thumbnail_blurhash)).toEqual(['LKO2?U%2Tw=w', null, null]);
    });

    it('gives an empty folder no tiles and a zero summary', async () => {
        const cover = find(await tree(), ids.empty as string)?.cover;

        expect(cover).toEqual({
            tiles: [],
            summary: { image: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 }, file: { count: 0, bytes: 0, top_types: [] } },
        });
    });

    it('leaves trashed documents out of tiles and totals', async () => {
        const cover = find(await tree(), ids.rome as string)?.cover;

        expect(cover?.tiles.map((tile) => tile.document_id)).not.toContain(ids.trashed);
        expect((cover?.summary as { image: { count: number } }).image.count).toBe(5);
    });

    it('builds the summary exactly as GET /documents/summary does for that folder', async () => {
        const cover = find(await tree(), ids.rome as string)?.cover;
        const expected = await summariseDocuments({ userId: carol, folderId: ids.rome as string, privateFolderIds: [] });

        expect(cover?.summary).toEqual(expected);
    });

    it('builds every cover in one call, for the open folders only', async () => {
        vi.mocked(loadFolderCovers).mockClear();
        await tree();

        const calls = vi.mocked(loadFolderCovers).mock.calls;

        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]).toBe(carol);
        expect(calls[0]?.[1]).toContain(ids.rome);
        expect(calls[0]?.[1]).not.toContain(ids.trips);
        expect(calls[0]?.[1]).not.toContain(ids.vault);
        expect(calls[0]?.[1]).not.toContain(ids.secret);
    });

    it('gives a collection no cover', async () => {
        expect(find(await tree(), ids.trips as string)?.cover).toBeNull();
    });

    it('gives a locked node no cover, no children and a count of 0', async () => {
        const vault = find(await tree(), ids.vault as string);

        expect(vault).toMatchObject({ locked: true, children: [], document_count: 0, cover: null });
        expect(JSON.stringify(vault)).not.toContain('inside-secret');
    });

    it('gives a private folder no cover even with its lock open: private documents stay out of every listing', async () => {
        const nodes = await tree([ids.vault as string]);
        const secret = find(nodes, ids.secret as string);

        expect(secret).toMatchObject({ locked: false, is_private: false, cover: null });
        expect(JSON.stringify(nodes)).not.toContain('inside-secret');
        expect(JSON.stringify(nodes)).not.toContain(ids.inSecret as string);
    });

    it('does not read the tiles of another user', async () => {
        const { alice, folders } = world();
        const response = await app.inject({
            method: 'GET',
            url: '/folders/tree',
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: alice, email: 'x@example.test' } as never) },
        });
        const nodes = JSON.parse(response.body) as Node[];

        expect(find(nodes, ids.rome as string)).toBeUndefined();
        expect(find(nodes, folders.invoices.id)?.cover?.tiles.map((tile) => tile.original_filename)).toEqual(['invoice-acme.pdf']);
    });
});

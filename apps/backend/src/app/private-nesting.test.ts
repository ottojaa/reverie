import sensible from '@fastify/sensible';
import type { FolderWithChildren } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({
    env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30, DUPLICATE_MIN_SIMILARITY: 0.9 },
}));
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

import { createAuthService } from '../services/auth.service.js';
import { seedPrivateBranches, seedPublicLibrary, SHARED_HASH, type PrivateBranches, type PublicLibrary } from '../testing/private-branches.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';
import duplicatesRoute from './routes/duplicates.route.js';
import favouritesRoute from './routes/favourites.route.js';
import foldersRoute from './routes/folders.route.js';
import searchRoute from './routes/search.route.js';

/** Every HTTP read that must not change, whatever is added beneath a private folder. */
function toListingUrls({ folders }: PublicLibrary): string[] {
    const scoped = [folders.public.id, folders.shelf.id];
    const queries = ['', 'ZEBRAWORD', 'tag:shared-tag', 'category:receipt', 'SECRET', 'secrettag', 'folder:SECRETC', 'folder:Shelf', '-folder:Shelf'];
    // `entity` is left out: its query is not valid SQL on any library, so there is no answer to compare.
    const suggestions = ['filename', 'folder', 'tag', 'category', 'location'].map((type) => '/search/suggest?type=' + type + '&q=s');

    return [
        ...queries.map((q) => '/search?limit=100&q=' + encodeURIComponent(q)),
        ...queries.map((q) => '/search/facets?q=' + encodeURIComponent(q)),
        ...scoped.flatMap((id) => ['/search?q=ZEBRAWORD&folder_id=' + id, '/search/facets?q=&folder_id=' + id]),
        ...suggestions,
        ...suggestions.map((url) => url + '&folder_id=' + folders.public.id),
        '/search/quick-filters',
        '/documents?limit=100',
        '/documents?limit=100&top_level=true',
        '/documents?limit=4&kind=image&preview=true',
        '/documents/summary',
        '/documents/summary?top_level=true',
        ...scoped.flatMap((id) => ['/documents?folder_id=' + id, '/documents/summary?folder_id=' + id]),
        '/duplicates',
    ];
}

/** Response fields that differ between any two identical requests. */
const toStable = (body: string): unknown => JSON.parse(body, (key, value) => (key === 'timing_ms' || key === 'query' ? undefined : value));

const NOTHING = { image: 0, video: 0, file: 0 };

describeDb('private folders at any depth, over HTTP', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let library: PublicLibrary;
    let branches: PrivateBranches;
    const before = new Map<string, unknown>();

    async function request(method: 'GET' | 'POST' | 'PUT', url: string, options: { open?: boolean; payload?: object } = {}) {
        const { userId } = library;
        const locks = options.open ? Object.values(branches.locks).map((folder) => folder.id) : [];
        const vault = app.jwt.sign({ sub: userId, scope: 'vault', locks } as never);
        const response = await app.inject({
            method,
            url,
            payload: options.payload,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: userId, email: 'c@example.test' } as never), cookie: 'vault_session=' + vault },
        });

        return { status: response.statusCode, raw: response.body };
    }

    async function fetchStable(url: string, open = false): Promise<unknown> {
        const response = await request('GET', url, { open });

        expect(response.status, url + ' ' + response.raw).toBe(200);

        return toStable(response.raw);
    }

    /** A response may repeat what the request itself named (a folder id, a typed filter), and nothing else private. */
    const expectNoMarkers = (raw: string, where: string, named = where) => {
        for (const marker of branches.markers.filter((text) => !named.includes(text))) expect(raw, where + ' shows ' + marker).not.toContain(marker);
    };

    const fetchTree = async (open = false) => (await fetchStable('/folders/tree', open)) as FolderWithChildren[];

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        for (const route of [documentsRoute, duplicatesRoute, favouritesRoute, foldersRoute, searchRoute]) await app.register(route);
        await app.ready();

        const { db } = ctx.world();

        library = await seedPublicLibrary(db);
        await db
            .updateTable('users')
            .set({ password_hash: await createAuthService(app).hashPassword('correct horse') })
            .where('id', '=', library.userId)
            .execute();
        expect((await request('PUT', '/favourites/folder/' + library.folders.public.id, { payload: { is_favourite: true } })).status).toBe(204);

        for (const url of [...toListingUrls(library), '/folders/tree', '/folders', '/favourites']) before.set(url, await fetchStable(url));

        branches = await seedPrivateBranches(db, library);
    }, 60_000);
    afterAll(() => app.close());

    it('changes no search, facet, suggestion, folder hit, count, listing or duplicate group, locked or open', async () => {
        // The comparison below means nothing unless the public library shows up in these.
        expect(before.get('/search?limit=100&q=ZEBRAWORD')).toMatchObject({ total: 5 });
        expect(before.get('/documents?limit=100')).toMatchObject({ total: 5 });
        expect((before.get('/duplicates') as { groups: unknown[] }).groups).toHaveLength(1);
        expect(before.get('/search/quick-filters')).not.toEqual([]);

        for (const open of [false, true]) {
            for (const url of toListingUrls(library)) {
                const response = await request('GET', url, { open });

                expect(toStable(response.raw), url).toEqual(before.get(url));
                expectNoMarkers(response.raw, url, decodeURIComponent(url));
            }
        }
    });

    it('finds nothing when a search is scoped to a folder beneath a lock', async () => {
        const ids = [...Object.values(branches.locks), ...Object.values(branches.hidden)].map((folder) => folder.id);

        for (const id of ids) {
            for (const open of [false, true]) {
                const response = await request('GET', '/search?q=ZEBRAWORD&folder_id=' + id, { open });

                if (response.status === 200) expect(JSON.parse(response.raw)).toMatchObject({ total: 0, results: [] });
                else expect(response.status).toBe(403);

                expectNoMarkers(response.raw, 'search in ' + id);
            }
        }
    });

    it('adds only a bare locked row to the tree, and nothing to the counts and covers of the folders above', async () => {
        const raw = (await request('GET', '/folders/tree')).raw;
        const tree = await fetchTree();
        const lockIds = Object.values(branches.locks).map((folder) => folder.id);
        const without = (nodes: FolderWithChildren[]): FolderWithChildren[] =>
            nodes.filter((node) => !lockIds.includes(node.id)).map((node) => ({ ...node, children: without(node.children) }));
        const flatten = (nodes: FolderWithChildren[]): FolderWithChildren[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
        const rows = flatten(tree).filter((node) => lockIds.includes(node.id));

        expectNoMarkers(raw, 'locked tree');
        expect(without(tree)).toEqual(before.get('/folders/tree'));
        expect(rows).toHaveLength(2);

        for (const row of rows) expect(row).toMatchObject({ locked: true, children: [], document_count: 0, kind_counts: NOTHING, cover: null });
    });

    it('keeps an open private folder out of the counts and covers above it, and gives it no cover', async () => {
        const [publicBefore] = before.get('/folders/tree') as FolderWithChildren[];
        const publicNow = (await fetchTree(true)).find((node) => node.id === library.folders.public.id)!;
        const shelfNow = publicNow.children[0]!;
        const secretD = shelfNow.children.find((node) => node.id === branches.locks.secretD.id)!;

        expect(publicNow).toMatchObject({ kind_counts: publicBefore!.kind_counts, cover: publicBefore!.cover });
        expect(shelfNow).toMatchObject({ kind_counts: publicBefore!.children[0]!.kind_counts, cover: publicBefore!.children[0]!.cover });
        expect(publicNow.kind_counts).toEqual({ image: 3, video: 0, file: 1 });
        expect(secretD).toMatchObject({ locked: false, kind_counts: { image: 2, video: 0, file: 0 }, cover: null });
        expect(secretD.children.map((node) => node.cover)).toEqual([null]);
    });

    it('refuses every folder hidden behind a closed lock, and lists only top-level rows', async () => {
        for (const { id } of Object.values(branches.hidden)) {
            for (const url of ['/folders/' + id, '/folders/' + id + '/children', '/documents?folder_id=' + id, '/documents/summary?folder_id=' + id]) {
                const response = await request('GET', url);

                expect(response.status, url).toBe(403);
                expectNoMarkers(response.raw, url);
            }
        }

        const roots = (await fetchStable('/folders')) as Array<{ id: string }>;

        expect(roots.filter((folder) => folder.id !== branches.locks.secretA.id)).toEqual(before.get('/folders'));
    });

    it('keeps private favourites anonymous, locked or open', async () => {
        const { secretD } = branches.locks;
        const starred = [
            ['folder', branches.hidden.secretC.id],
            ['folder', secretD.id],
            ['document', branches.deepDoc],
        ] as const;

        for (const [type, id] of starred) {
            expect((await request('PUT', '/favourites/' + type + '/' + id, { open: true, payload: { is_favourite: true } })).status).toBe(204);
        }

        for (const open of [false, true]) {
            const { raw } = await request('GET', '/favourites', { open });
            const items = (JSON.parse(raw) as { items: Array<{ id: string; private: boolean }> }).items;
            const privateItems = items.filter((item) => item.private);

            expect(items.filter((item) => !item.private)).toEqual((before.get('/favourites') as { items: unknown[] }).items);
            expect(privateItems).toHaveLength(3);

            for (const item of privateItems) expect(item).toMatchObject({ location: null, folder: null, document: null });

            // A private favourite carries the starred id itself, and nothing else about it.
            expectNoMarkers(raw, 'favourites', starred.map(([, id]) => id).join(' '));
        }
    });

    it('answers a content check with "private" and nothing else', async () => {
        const files = [
            { name: 'one.jpg', sha256: branches.privateOnlyHash },
            { name: 'two.jpg', sha256: SHARED_HASH },
        ];

        for (const open of [false, true]) {
            const { raw } = await request('POST', '/documents/check-content', { open, payload: { files } });
            const [privateOnly, shared] = (JSON.parse(raw) as { results: Array<{ content: unknown }> }).results;

            expect(privateOnly?.content).toEqual({ where: 'private' });
            expect(shared?.content).toEqual({ where: 'folder', folder_path: ['Public'], filename: 'public-photo.jpg' });
            expectNoMarkers(raw, 'check-content');
        }
    });
});

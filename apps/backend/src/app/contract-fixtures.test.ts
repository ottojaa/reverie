import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sensible from '@fastify/sensible';
import { DocumentListResponseSchema, FolderTreeResponseSchema, SearchResponseSchema } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

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

import { seedContractLibrary, type ContractLibrary } from '../testing/contract-library.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';
import foldersRoute from './routes/folders.route.js';
import searchRoute from './routes/search.route.js';

/**
 * Writes down what the real routes answer, as the fixtures client code parses in its own tests. This test fails
 * when a route's answer no longer matches its committed fixture. To accept the new answer, run it with
 * UPDATE_FIXTURES=1 and then `npx nx format:write`.
 */
const FIXTURES = join(__dirname, '../../../../libs/shared/src/fixtures');

/** The seeded ids are random, so each is written as a fixed one: folders start with 1, documents with 2, the user with 3. */
function toFixedIds(library: ContractLibrary): Array<[string, string]> {
    const toFixed =
        (group: number) =>
        (id: string, index: number): [string, string] => [id, group + '0000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')];

    return [...Object.values(library.folderIds).map(toFixed(1)), ...library.documentIds.map(toFixed(2)), toFixed(3)(library.userId, 0)];
}

interface Facet {
    count: number;
}

/** Facet values with equal counts come back in no particular order. */
function byCountThenText(a: Facet, b: Facet): number {
    return b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b));
}

function toFixture(body: string, library: ContractLibrary): unknown {
    const text = toFixedIds(library).reduce((result, [seeded, fixed]) => result.replaceAll(seeded, fixed), body);

    return JSON.parse(text, (key, value) => {
        if (key === 'timing_ms') return 0;

        // The database stamps this on every change to a row.
        if (key === 'updated_at') return '2026-06-30T10:00:00.000Z';

        if (key !== 'facets') return value;

        return Object.fromEntries(Object.entries(value as Record<string, Facet[]>).map(([name, values]) => [name, [...values].sort(byCountThenText)]));
    });
}

describeDb('contract fixtures', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let library: ContractLibrary;

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        for (const route of [documentsRoute, foldersRoute, searchRoute]) await app.register(route);
        await app.ready();
        library = await seedContractLibrary(ctx.world().db);
        // Search names its upload periods by how long ago the seeded dates are.
        vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-01T12:00:00Z') });
    }, 60_000);
    afterAll(async () => {
        vi.useRealTimers();
        await app.close();
    });

    /** The answer as a person sees it with the "Taxes" lock open and the other one closed. */
    async function fetchFixture(url: string): Promise<unknown> {
        const { userId, folderIds } = library;
        const vault = app.jwt.sign({ sub: userId, scope: 'vault', locks: [folderIds.taxes] } as never);
        const response = await app.inject({
            url,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: userId, email: 'f@example.test' } as never), cookie: 'vault_session=' + vault },
        });

        expect(response.statusCode, url + ' ' + response.body).toBe(200);

        return toFixture(response.body, library);
    }

    function expectFixture(name: string, actual: unknown) {
        const file = join(FIXTURES, name);

        if (process.env['UPDATE_FIXTURES']) writeFileSync(file, JSON.stringify(actual, null, 4) + '\n');

        expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    }

    it('folder tree: three levels, a closed lock, an open private folder, top-level folders holding files', async () => {
        const tree = await fetchFixture('/folders/tree');

        expect(FolderTreeResponseSchema.parse(tree)).toHaveLength(3);
        expectFixture('folder-tree.json', tree);
    });

    it('search scoped to a folder: what it and the folders beneath it hold', async () => {
        const { folderIds } = library;
        const found = await fetchFixture('/search?q=holiday&sort_by=uploaded&folder_id=' + folderIds.photos);

        expect(SearchResponseSchema.parse(found).total).toBe(2);
        expectFixture('folder-search.json', found);
    });

    it('documents in no folder', async () => {
        const page = await fetchFixture('/documents?top_level=true&limit=20');

        expect(DocumentListResponseSchema.parse(page).total).toBe(2);
        expectFixture('top-level-documents.json', page);
    });
});

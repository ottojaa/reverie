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

import { hashPassword } from '../services/auth.service.js';
import { seedContractLibrary, type ContractLibrary } from '../testing/contract-library.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';
import foldersRoute from './routes/folders.route.js';
import searchRoute from './routes/search.route.js';
import vaultRoute from './routes/vault.route.js';

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
        for (const route of [documentsRoute, foldersRoute, searchRoute, vaultRoute]) await app.register(route);
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
    async function fetchFixture(url: string, generation = 0): Promise<unknown> {
        const { userId, folderIds } = library;
        const vault = app.jwt.sign({ sub: userId, scope: 'vault', locks: [folderIds.taxes], gen: generation } as never);
        const response = await app.inject({ url, headers: { ...toLoginHeader(), cookie: 'vault_session=' + vault } });

        expect(response.statusCode, url + ' ' + response.body).toBe(200);

        return toFixture(response.body, library);
    }

    const toLoginHeader = () => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: library.userId, email: 'f@example.test' } as never) });

    /** Sends the unlock request installed apps send, as committed, for the seeded "Taxes" folder. */
    async function sendUnlockFixture(password: string) {
        const request = JSON.parse(readFileSync(join(FIXTURES, 'vault-unlock-request.json'), 'utf8')) as { folder_id: string };
        const [seededTaxes] = toFixedIds(library).find(([, fixed]) => fixed === request.folder_id)!;
        const payload = { ...request, password, folder_id: seededTaxes };

        return app.inject({ method: 'POST', url: '/vault/unlock', headers: toLoginHeader(), payload });
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

    it('search that finds a folder by its name', async () => {
        const found = await fetchFixture('/search?q=norway');

        expect(SearchResponseSchema.parse(found).results.map((hit) => hit.result_type)).toContain('collection');
        expectFixture('folder-hit-search.json', found);
    });

    it('folder locks with a PIN set: the unlock installed apps send, the status, and both refusals', async () => {
        const accountPassword = 'correct horse battery staple';

        await ctx
            .world()
            .db.updateTable('users')
            .set({ password_hash: await hashPassword(accountPassword) })
            .where('id', '=', library.userId)
            .execute();
        await app.inject({
            method: 'PUT',
            url: '/vault/secret',
            headers: toLoginHeader(),
            payload: { account_password: accountPassword, secret: { kind: 'pin', value: '4821' } },
        });
        await ctx.world().db.updateTable('folder_lock_secrets').set({ wrong_tries: 2 }).execute();

        const opened = await sendUnlockFixture('4821');
        const refused = await sendUnlockFixture('0000');

        await ctx.world().db.updateTable('folder_lock_secrets').set({ wrong_tries: 10 }).execute();

        const stopped = await sendUnlockFixture('4821');

        expect([opened.statusCode, refused.statusCode, stopped.statusCode]).toEqual([200, 403, 403]);
        await ctx.world().db.updateTable('folder_lock_secrets').set({ wrong_tries: 0 }).execute();
        expectFixture('vault-status.json', await fetchFixture('/vault/status', 1));
        expectFixture('vault-refusal-tries-left.json', toFixture(refused.body, library));
        expectFixture('vault-refusal-stopped.json', toFixture(stopped.body, library));
    });

    it('documents in no folder', async () => {
        const page = await fetchFixture('/documents?top_level=true&limit=20');

        expect(DocumentListResponseSchema.parse(page).total).toBe(2);
        expectFixture('top-level-documents.json', page);
    });
});

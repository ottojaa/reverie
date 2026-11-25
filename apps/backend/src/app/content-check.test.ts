import sensible from '@fastify/sensible';
import { createHash } from 'crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { createAuthService } from '../services/auth.service.js';
import { seedDocument, seedFolder } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';
import vaultRoute from './routes/vault.route.js';

const PASSWORD = 'correct horse battery staple';

/** The hash the server would store for these bytes. */
const sha = (content: string): string => createHash('sha256').update(content).digest('hex');

type Content = { where: 'folder'; folder_path: string[] | null; filename: string } | { where: 'private' } | { where: 'trash' } | null;
interface Result {
    name: string;
    sha256: string | null;
    content: Content;
    name_conflict: boolean;
}

describeDb('POST /documents/check-content', () => {
    const ctx = useWorld();
    let app: FastifyInstance;

    const world = (): World => ctx.world();
    const token = (userId: string) => app.jwt.sign({ sub: userId, email: 'x@example.test' } as never);

    async function post(url: string, payload: object, opts: { userId?: string; cookie?: string } = {}) {
        const response = await app.inject({
            method: 'POST',
            url,
            payload,
            headers: { authorization: 'Bearer ' + token(opts.userId ?? world().alice), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
        });

        return { status: response.statusCode, raw: response.body, body: response.body ? JSON.parse(response.body) : null };
    }

    async function check(files: Array<{ name: string; sha256?: string }>, folderId?: string, opts: { userId?: string; cookie?: string } = {}) {
        const response = await post('/documents/check-content', { ...(folderId ? { folder_id: folderId } : {}), files }, opts);

        return { ...response, results: (response.body?.results ?? []) as Result[] };
    }

    /** The session cookie a browser holds after unlocking one private folder. */
    async function unlockCookie(folderId: string): Promise<string> {
        const response = await app.inject({
            method: 'POST',
            url: '/vault/unlock',
            payload: { password: PASSWORD, folder_id: folderId },
            headers: { authorization: 'Bearer ' + token(world().alice) },
        });

        expect(response.statusCode).toBe(200);

        return String([response.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';
    }

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        for (const route of [documentsRoute, vaultRoute]) await app.register(route);
        await app.ready();

        await world()
            .db.updateTable('users')
            .set({ password_hash: await createAuthService(app).hashPassword(PASSWORD) })
            .execute();
    }, 60_000);
    afterAll(() => app.close());

    it('points at the folder path and filename when the content is in another folder', async () => {
        const { db, alice, folders } = world();
        await seedDocument(db, { userId: alice, name: 'holiday.jpg', folderId: folders.invoices.id, hash: sha('other-folder') });

        const { status, results } = await check([{ name: 'copy-of-holiday.jpg', sha256: sha('other-folder') }], folders.empty.id);

        expect(status).toBe(200);
        expect(results).toEqual([
            {
                name: 'copy-of-holiday.jpg',
                sha256: sha('other-folder'),
                content: { where: 'folder', folder_path: ['Work', 'Invoices'], filename: 'holiday.jpg' },
                name_conflict: false,
            },
        ]);
    });

    it('names every folder from the top down, however deep', async () => {
        const { db, alice, folders } = world();
        const year = await seedFolder(db, alice, '2026', { parent: folders.invoices });
        const month = await seedFolder(db, alice, 'May', { parent: year });
        await seedDocument(db, { userId: alice, name: 'deep.jpg', folderId: month.id, hash: sha('deep') });

        const { results } = await check([{ name: 'x.jpg', sha256: sha('deep') }]);

        expect(results[0]?.content).toEqual({ where: 'folder', folder_path: ['Work', 'Invoices', '2026', 'May'], filename: 'deep.jpg' });
    });

    it('checks names at the top level only when asked to', async () => {
        const { db, alice } = world();
        await seedDocument(db, { userId: alice, name: 'unfiled.pdf', hash: sha('unfiled-v1') });
        const files = [{ name: 'unfiled.pdf', sha256: sha('unfiled-v2') }];

        expect((await post('/documents/check-content', { files })).body.results[0].name_conflict).toBe(false);
        expect((await post('/documents/check-content', { top_level: true, files })).body.results[0].name_conflict).toBe(true);
    });

    it('builds the path from current names, not the stored folders.path', async () => {
        const { db, alice, folders } = world();
        await db.updateTable('folders').set({ name: 'Renamed Work' }).where('id', '=', folders.work.id).execute();
        await seedDocument(db, { userId: alice, name: 'stale-path.jpg', folderId: folders.invoices.id, hash: sha('stale-path') });

        const { results } = await check([{ name: 'x.jpg', sha256: sha('stale-path') }]);

        await db.updateTable('folders').set({ name: 'Work' }).where('id', '=', folders.work.id).execute();

        expect(results[0]?.content).toEqual({ where: 'folder', folder_path: ['Renamed Work', 'Invoices'], filename: 'stale-path.jpg' });
    });

    it('reports a document at the root with a null path', async () => {
        const { db, alice } = world();
        await seedDocument(db, { userId: alice, name: 'root.jpg', hash: sha('root') });

        const { results } = await check([{ name: 'x.jpg', sha256: sha('root') }]);

        expect(results[0]?.content).toEqual({ where: 'folder', folder_path: null, filename: 'root.jpg' });
    });

    it('says "trash" when every copy is trashed, and prefers a live copy when there is one', async () => {
        const { db, alice, folders } = world();
        await seedDocument(db, { userId: alice, name: 'old.jpg', folderId: folders.work.id, deleted: true, hash: sha('only-trash') });
        await seedDocument(db, { userId: alice, name: 'gone.jpg', folderId: folders.work.id, deleted: true, hash: sha('trash-and-live') });
        await seedDocument(db, { userId: alice, name: 'kept.jpg', folderId: folders.invoices.id, hash: sha('trash-and-live') });

        const { results } = await check([
            { name: 'a.jpg', sha256: sha('only-trash') },
            { name: 'b.jpg', sha256: sha('trash-and-live') },
        ]);

        expect(results.map((r) => r.content)).toEqual([{ where: 'trash' }, { where: 'folder', folder_path: ['Work', 'Invoices'], filename: 'kept.jpg' }]);
    });

    describe('private folders', () => {
        /** Every identifier of the private places and the private document: none may appear in a response. */
        const markers = (privateFilename: string) => {
            const { folders } = world();

            return [
                folders.vault.id,
                folders.vaultMiddle.id,
                folders.vaultInner.id,
                folders.lockedFolder.id,
                folders.secretParent.id,
                folders.secretMiddle.id,
                'Vault',
                'Middle',
                'Inner',
                'Hidden',
                'Archive',
                'Years',
                privateFilename,
            ];
        };

        it('answers "private" with no id, name or path for a document deep beneath a private folder', async () => {
            const { db, alice } = world();
            const { folders } = world();
            const id = await seedDocument(db, {
                userId: alice,
                name: 'tax-return-secret.pdf',
                folderId: folders.vaultInner.id,
                hash: sha('deep-private'),
            });

            const { status, raw, results } = await check([{ name: 'scan.pdf', sha256: sha('deep-private') }]);

            expect(status).toBe(200);
            expect(results[0]?.content).toEqual({ where: 'private' });
            for (const marker of [...markers('tax-return-secret.pdf'), id]) expect(raw).not.toContain(marker);
        });

        it('answers "private" for a private folder deep beneath public ones', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'diary-secret.pdf', folderId: folders.lockedFolder.id, hash: sha('private-folder') });

            const { raw, results } = await check([{ name: 'scan.pdf', sha256: sha('private-folder') }]);

            expect(results[0]?.content).toEqual({ where: 'private' });
            for (const marker of markers('diary-secret.pdf')) expect(raw).not.toContain(marker);
        });

        it('answers the same, and still leaks nothing, once the folder is unlocked', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'unlocked-secret.pdf', folderId: folders.lockedFolder.id, hash: sha('unlocked') });
            const cookie = await unlockCookie(folders.lockedFolder.id);
            const { status, raw: body, results } = await check([{ name: 'scan.pdf', sha256: sha('unlocked') }], folders.lockedFolder.id, { cookie });

            expect(status).toBe(200);
            expect(results[0]?.content).toEqual({ where: 'private' });
            for (const marker of markers('unlocked-secret.pdf')) expect(body).not.toContain(marker);
        });

        it('treats a trashed document in a private folder as private, not as trash', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'trashed-secret.pdf', folderId: folders.vaultInner.id, deleted: true, hash: sha('trashed-private') });

            const { results } = await check([{ name: 'scan.pdf', sha256: sha('trashed-private') }]);

            expect(results[0]?.content).toEqual({ where: 'private' });
        });

        it('points at the ordinary copy when the content is both public and private', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'hidden-twin.pdf', folderId: folders.vaultInner.id, hash: sha('both') });
            await seedDocument(db, { userId: alice, name: 'public-twin.pdf', folderId: folders.work.id, hash: sha('both') });

            const { raw, results } = await check([{ name: 'scan.pdf', sha256: sha('both') }]);

            expect(results[0]?.content).toEqual({ where: 'folder', folder_path: ['Work'], filename: 'public-twin.pdf' });
            expect(raw).not.toContain('hidden-twin.pdf');
        });

        it('refuses a locked target folder, like check-duplicates', async () => {
            const { status, body } = await check([{ name: 'a.pdf', sha256: sha('anything') }], world().folders.lockedFolder.id);

            expect(status).toBe(403);
            expect(body.error).toBe('FOLDER_LOCKED');
        });
    });

    describe('names in the target folder', () => {
        it('flags the same name with different content', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'report.pdf', folderId: folders.empty.id, hash: sha('report-v1') });

            const { results } = await check([{ name: 'report.pdf', sha256: sha('report-v2') }], folders.empty.id);

            expect(results[0]).toMatchObject({ content: null, name_conflict: true });
        });

        it('reports both at once: the content elsewhere and the name taken here', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'budget.xlsx', folderId: folders.empty.id, hash: sha('budget-old') });
            await seedDocument(db, { userId: alice, name: 'budget-2024.xlsx', folderId: folders.invoices.id, hash: sha('budget-new') });

            const { results } = await check([{ name: 'budget.xlsx', sha256: sha('budget-new') }], folders.empty.id);

            expect(results[0]).toEqual({
                name: 'budget.xlsx',
                sha256: sha('budget-new'),
                content: { where: 'folder', folder_path: ['Work', 'Invoices'], filename: 'budget-2024.xlsx' },
                name_conflict: true,
            });
        });

        it('flags the identical file with the same name in the target too, so "upload anyway" can ask replace or keep both', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'same.pdf', folderId: folders.empty.id, hash: sha('same') });

            const { results } = await check([{ name: 'same.pdf', sha256: sha('same') }], folders.empty.id);

            expect(results[0]).toMatchObject({ content: { where: 'folder', folder_path: ['Empty'], filename: 'same.pdf' }, name_conflict: true });
        });

        it('flags it in an unlocked private target as well, where the content is only "private"', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'journal.pdf', folderId: folders.lockedFolder.id, hash: sha('journal') });
            const cookie = await unlockCookie(folders.lockedFolder.id);

            const { results } = await check([{ name: 'journal.pdf', sha256: sha('journal') }], folders.lockedFolder.id, { cookie });

            expect(results[0]).toMatchObject({ content: { where: 'private' }, name_conflict: true });
        });

        it('ignores a trashed document of the same name', async () => {
            const { db, alice, folders } = world();
            await seedDocument(db, { userId: alice, name: 'binned.pdf', folderId: folders.empty.id, deleted: true, hash: sha('binned') });

            const { results } = await check([{ name: 'binned.pdf', sha256: sha('binned-new') }], folders.empty.id);

            expect(results[0]?.name_conflict).toBe(false);
        });
    });

    it("never matches another user's identical file", async () => {
        const { db, bob, folders } = world();
        await seedDocument(db, { userId: bob, name: 'bobs.jpg', folderId: folders.bobs.id, hash: sha('bobs-only') });

        const { raw, results } = await check([{ name: 'x.jpg', sha256: sha('bobs-only') }]);

        expect(results[0]?.content).toBeNull();
        expect(raw).not.toContain('bobs.jpg');
    });

    it('checks content without a target folder, so name_conflict stays false', async () => {
        const { db, alice, folders } = world();
        await seedDocument(db, { userId: alice, name: 'no-target.jpg', folderId: folders.work.id, hash: sha('no-target') });

        const { results } = await check([{ name: 'no-target.jpg', sha256: sha('no-target') }]);

        expect(results[0]).toMatchObject({ content: { where: 'folder', folder_path: ['Work'] }, name_conflict: false });
    });

    it('still checks the name of a file the client could not hash', async () => {
        const { db, alice, folders } = world();
        await seedDocument(db, { userId: alice, name: 'unhashed.pdf', folderId: folders.empty.id, hash: sha('unhashed') });

        const { results } = await check([{ name: 'unhashed.pdf' }], folders.empty.id);

        expect(results[0]).toEqual({ name: 'unhashed.pdf', sha256: null, content: null, name_conflict: true });
    });

    it('accepts upper-case hashes and answers every file in request order, repeats included', async () => {
        const { db, alice, folders } = world();
        await seedDocument(db, { userId: alice, name: 'ordered.jpg', folderId: folders.work.id, hash: sha('ordered') });

        const { results } = await check([
            { name: 'one.jpg', sha256: sha('nothing-here') },
            { name: 'two.jpg', sha256: sha('ordered').toUpperCase() },
            { name: 'two-again.jpg', sha256: sha('ordered') },
        ]);

        expect(results.map((r) => [r.name, r.content?.where ?? null])).toEqual([
            ['one.jpg', null],
            ['two.jpg', 'folder'],
            ['two-again.jpg', 'folder'],
        ]);
    });

    it('handles a batch of 500 files in one call', async () => {
        const { db, alice, folders } = world();
        await seedDocument(db, { userId: alice, name: 'batch-hit.jpg', folderId: folders.work.id, hash: sha('batch-hit') });
        const files = Array.from({ length: 500 }, (_, i) => ({ name: `f${i}.jpg`, sha256: sha(i === 321 ? 'batch-hit' : 'batch-miss-' + i) }));

        const { status, results } = await check(files, folders.empty.id);

        expect(status).toBe(200);
        expect(results).toHaveLength(500);
        expect(results.filter((r) => r.content !== null).map((r) => r.name)).toEqual(['f321.jpg']);
    });

    it('rejects a malformed hash and more than 500 files', async () => {
        expect((await check([{ name: 'a.jpg', sha256: 'not-a-hash' }])).status).toBe(400);
        expect((await check(Array.from({ length: 501 }, (_, i) => ({ name: `f${i}.jpg`, sha256: sha(String(i)) })))).status).toBe(400);
    });

    it('requires a login', async () => {
        const response = await app.inject({ method: 'POST', url: '/documents/check-content', payload: { files: [{ name: 'a.jpg' }] } });

        expect(response.statusCode).toBe(401);
    });

    describe('the older /documents/check-duplicates', () => {
        it('still answers with the filenames that exist in the folder', async () => {
            const { folders } = world();
            const { status, body } = await post('/documents/check-duplicates', { folder_id: folders.work.id, filenames: ['notes.pdf', 'absent.pdf'] });

            expect(status).toBe(200);
            expect(body).toEqual({ duplicates: ['notes.pdf'] });
        });

        it('still refuses a locked folder', async () => {
            const { status, body } = await post('/documents/check-duplicates', { folder_id: world().folders.lockedFolder.id, filenames: ['a.pdf'] });

            expect(status).toBe(403);
            expect(body.error).toBe('FOLDER_LOCKED');
        });
    });
});

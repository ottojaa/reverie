import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { createAuthService } from '../services/auth.service.js';
import { trashFolder } from '../services/folders/trash.js';
import { seedDocument, seedFolder } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import authRoute from './routes/auth.route.js';
import documentsRoute from './routes/documents.route.js';
import foldersRoute from './routes/folders.route.js';
import jobsRoute from './routes/jobs.route.js';
import searchRoute from './routes/search.route.js';
import trashRoute from './routes/trash.route.js';
import vaultRoute from './routes/vault.route.js';

const PASSWORD = 'correct horse battery staple';

/** A browser session: a login token plus whatever cookies the server has set (the folder-lock cookie among them). */
class Session {
    private cookies = new Map<string, string>();

    constructor(
        private readonly app: FastifyInstance,
        private readonly token: string,
    ) {}

    get vaultCookie(): string | undefined {
        return this.cookies.get('vault_session');
    }

    async request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, headers: Record<string, string> = {}) {
        const cookie = Array.from(this.cookies, ([name, value]) => name + '=' + value).join('; ');
        const response = await this.app.inject({
            method,
            url,
            payload,
            headers: { authorization: 'Bearer ' + this.token, ...(cookie ? { cookie } : {}), ...headers },
        });

        for (const set of [response.headers['set-cookie']].flat()) {
            if (!set) continue;

            const [pair = ''] = set.split(';');
            const [name = '', value = ''] = pair.split('=');

            if (value === '' || /expires=Thu, 01 Jan 1970/i.test(set)) this.cookies.delete(name);
            else this.cookies.set(name, value);
        }

        return { status: response.statusCode, body: response.body ? safeParse(response.body) : null, raw: response.body };
    }

    get = (url: string) => this.request('GET', url);
    unlock = (folderId: string, password = PASSWORD) => this.request('POST', '/vault/unlock', { password, folder_id: folderId });
}

function safeParse(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

describeDb('folder locks over HTTP', () => {
    const ctx = useWorld();
    let app: FastifyInstance;

    const world = (): World => ctx.world();
    const newSession = (userId = world().alice) => new Session(app, app.jwt.sign({ sub: userId, email: 'x@example.test' } as never));

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        for (const route of [authRoute, documentsRoute, foldersRoute, jobsRoute, searchRoute, trashRoute, vaultRoute]) await app.register(route);
        await app.ready();

        const hash = await createAuthService(app).hashPassword(PASSWORD);

        await world().db.updateTable('users').set({ password_hash: hash }).execute();
    }, 60_000);
    afterAll(() => app.close());

    /** Everything that must stay out of a response while a folder is closed (and, for the listings, even when it is open). */
    const privateMarkers = () => {
        const { docs } = world();

        // Search echoes the query back, so look for ids and filenames rather than the words in the OCR text.
        return [docs.inLockedFolder, docs.inVault, docs.inVaultInner, 'in-locked-folder.pdf', 'in-vault.pdf', 'in-vault-inner.pdf'];
    };

    const expectNoPrivateData = (raw: string) => {
        for (const marker of privateMarkers()) expect(raw).not.toContain(marker);
    };

    describe('what unlocking opens', () => {
        it('keeps a private folder closed until its own password check, and answers FOLDER_LOCKED', async () => {
            const session = newSession();
            const refused = await session.get('/documents?folder_id=' + world().folders.lockedFolder.id);

            expect(refused.status).toBe(403);
            expect(refused.body.error).toBe('FOLDER_LOCKED');
            expectNoPrivateData(refused.raw);
        });

        it('rejects a wrong password and a folder that is not private', async () => {
            const session = newSession();

            expect((await session.unlock(world().folders.lockedFolder.id, 'nope')).status).toBe(401);
            expect((await session.unlock(world().folders.work.id)).status).toBe(404);
            expect(session.vaultCookie).toBeUndefined();
        });

        it('opens exactly one lock: unlocking a leaves b locked', async () => {
            const { folders, docs } = world();
            const session = newSession();

            expect((await session.unlock(folders.lockedFolder.id)).status).toBe(200);

            const open = await session.get('/documents?folder_id=' + folders.lockedFolder.id);
            const other = await session.get('/documents?folder_id=' + folders.vaultInner.id);

            expect(open.status).toBe(200);
            expect(open.body.items.map((d: { id: string }) => d.id)).toEqual([docs.inLockedFolder]);
            expect(other.status).toBe(403);
            expect((await session.get('/documents/' + docs.inVaultInner)).status).toBe(403);
        });

        it('lets a private folder’s lock cover everything beneath it, at any depth', async () => {
            const { folders, docs } = world();
            const session = newSession();

            await session.unlock(folders.vault.id);

            expect((await session.get('/documents?folder_id=' + folders.vaultInner.id)).body.items.map((d: { id: string }) => d.id)).toEqual([
                docs.inVaultInner,
            ]);
            expect((await session.get('/documents?folder_id=' + folders.vault.id)).status).toBe(200);
            expect((await session.get('/documents?folder_id=' + folders.lockedFolder.id)).status).toBe(403);
        });

        it('hides every folder beneath a closed one, and opens the whole branch when asked for any of them', async () => {
            const { folders, docs } = world();
            const session = newSession();

            for (const id of [folders.vaultMiddle.id, folders.vaultInner.id]) {
                for (const url of ['/folders/' + id, '/folders/' + id + '/children', '/documents?folder_id=' + id]) {
                    const refused = await session.get(url);

                    expect(refused.status, url).toBe(403);
                    expect(refused.raw, url).not.toMatch(/Middle|Inner|in-vault/);
                }
            }

            expect((await session.unlock(folders.vaultInner.id)).status).toBe(200);
            expect((await session.get('/folders/' + folders.vaultMiddle.id)).body).toMatchObject({
                is_private: false,
                lock_id: folders.vault.id,
                locked: false,
            });
            expect((await session.get('/documents?folder_id=' + folders.vaultInner.id)).body.items.map((d: { id: string }) => d.id)).toEqual([
                docs.inVaultInner,
            ]);
        });

        it('keeps the folder open for the whole session, and a second session stays locked', async () => {
            const { folders } = world();
            const first = newSession();
            const second = newSession();

            await first.unlock(folders.lockedFolder.id);

            expect((await first.get('/documents?folder_id=' + folders.lockedFolder.id)).status).toBe(200);
            expect((await second.get('/documents?folder_id=' + folders.lockedFolder.id)).status).toBe(403);
        });

        it('reports the status of the session', async () => {
            const session = newSession();

            expect((await session.get('/vault/status')).body).toEqual({ unlocked: false, has_password: true });
            await session.unlock(world().folders.lockedFolder.id);
            expect((await session.get('/vault/status')).body).toEqual({ unlocked: true, has_password: true });
        });
    });

    describe('what never leaves a folder', () => {
        const listings = (folderId: string) => [
            '/documents',
            '/documents?page=1&limit=100',
            '/documents?sort_by=uploaded',
            '/search?q=LOCKEDWORD',
            '/search?q=tag:lockedtag',
            '/search?q=',
            '/search/facets?q=',
            '/search/suggest?type=tag&q=locked',
            '/search/quick-filters',
            '/folders/tree',
            '/folders',
            '/trash',
            '/folders/' + folderId + '/children',
        ];

        it('hides private documents from every listing, search, facet, suggestion and count, locked or unlocked', async () => {
            const { folders } = world();
            const locked = newSession();
            const unlocked = newSession();

            await unlocked.unlock(folders.lockedFolder.id);
            await unlocked.unlock(folders.vault.id);

            for (const session of [locked, unlocked]) {
                for (const url of listings(folders.work.id)) {
                    const response = await session.get(url);

                    expect(response.status, url).toBeLessThan(500);
                    expectNoPrivateData(response.raw);
                }
            }
        });

        it('finds no private text or tag in search or suggestions, even with the folder open', async () => {
            const session = newSession();

            await session.unlock(world().folders.lockedFolder.id);
            await session.unlock(world().folders.vault.id);

            expect((await session.get('/search?q=LOCKEDWORD')).body.total).toBe(0);
            expect((await session.get('/search/suggest?type=tag&q=locked')).raw).not.toContain('lockedtag');
        });

        it('does not count private documents in the totals of an unfiltered listing', async () => {
            const { db, alice } = world();
            const visible = await db
                .selectFrom('documents')
                .select(db.fn.countAll<string>().as('n'))
                .where('user_id', '=', alice)
                .where('deleted_at', 'is', null)
                .where((eb) =>
                    eb.or([
                        eb('folder_id', 'is', null),
                        eb('folder_id', 'not in', [
                            world().folders.vault.id,
                            world().folders.vaultMiddle.id,
                            world().folders.vaultInner.id,
                            world().folders.lockedFolder.id,
                        ]),
                    ]),
                )
                .executeTakeFirstOrThrow();
            const session = newSession();

            await session.unlock(world().folders.lockedFolder.id);

            expect((await session.get('/documents?limit=100')).body.total).toBe(Number(visible.n));
        });

        it('shows a closed folder as a locked row with no children and no documents', async () => {
            const session = newSession();
            const tree = (await session.get('/folders/tree')).body as Array<{
                id: string;
                name: string;
                locked: boolean;
                children: unknown[];
                document_count: number;
            }>;
            const vault = tree.find((node) => node.id === world().folders.vault.id);

            expect(vault).toMatchObject({ name: 'Vault', locked: true, children: [], document_count: 0 });
        });

        it('shows everything beneath an opened folder', async () => {
            const session = newSession();

            await session.unlock(world().folders.vault.id);

            const tree = (await session.get('/folders/tree')).body as Array<{
                id: string;
                locked: boolean;
                children: Array<{ id: string; locked: boolean; children: Array<{ id: string }> }>;
            }>;
            const vault = tree.find((node) => node.id === world().folders.vault.id);

            expect(vault?.locked).toBe(false);
            expect(vault?.children.map((child) => child.id)).toEqual([world().folders.vaultMiddle.id]);
            expect(vault?.children[0]?.children.map((child) => child.id)).toEqual([world().folders.vaultInner.id]);
        });
    });

    describe('document routes', () => {
        const documentRoutes = (id: string) => [
            ['GET', '/documents/' + id],
            ['GET', '/documents/' + id + '/ocr'],
            ['GET', '/documents/' + id + '/llm'],
            ['GET', '/documents/' + id + '/jobs'],
            ['GET', '/documents/' + id + '/status'],
            ['GET', '/documents/' + id + '/thumbnail/sm'],
            ['PATCH', '/documents/' + id, { original_filename: 'renamed.pdf' }],
            ['PATCH', '/documents/' + id + '/file', {}],
            ['DELETE', '/documents/' + id],
        ];

        it('refuses every per-document route of a closed folder, serving none of its content', async () => {
            const session = newSession();

            for (const [method, url, payload] of documentRoutes(world().docs.inLockedFolder) as Array<['GET' | 'PATCH' | 'DELETE', string, object?]>) {
                const response = await session.request(method, url, payload);

                expect(response.status, method + ' ' + url).toBe(403);
                expectNoPrivateData(response.raw);
            }
        });

        it('serves the same routes once the folder is open', async () => {
            const { docs, folders } = world();
            const session = newSession();

            await session.unlock(folders.lockedFolder.id);

            const detail = await session.get('/documents/' + docs.inLockedFolder);

            expect(detail.status).toBe(200);
            expect(detail.body.is_private).toBe(true);
            expect((await session.get('/documents/' + docs.inLockedFolder + '/ocr')).status).toBe(200);
            expect((await session.get('/documents/' + docs.inLockedFolder + '/jobs')).status).toBe(200);
            expect((await session.get('/documents/' + docs.inLockedFolder + '/llm')).status).not.toBe(403);
        });

        it('gates every /documents/:id route that exists', async () => {
            const registered: string[] = [];
            const probe = Fastify();

            probe.setValidatorCompiler(validatorCompiler);
            probe.setSerializerCompiler(serializerCompiler);

            probe.addHook('onRoute', (route) => {
                if (route.url.startsWith('/documents/:id') && route.method !== 'HEAD') registered.push(String(route.method) + ' ' + route.url);
            });
            probe.decorate('authenticate', async () => undefined);
            await probe.register(documentsRoute);
            await probe.ready();

            const tested = new Set([
                'GET /documents/:id',
                'GET /documents/:id/ocr',
                'GET /documents/:id/llm',
                'GET /documents/:id/jobs',
                'GET /documents/:id/status',
                'GET /documents/:id/thumbnail/:size',
                'PATCH /documents/:id',
                'PATCH /documents/:id/file',
                'DELETE /documents/:id',
            ]);
            // Routes that start work rather than read content; each calls loadOpenDocument first (see the routes file).
            const startsWork = new Set([
                'POST /documents/:id/ocr',
                'POST /documents/:id/ocr/retry',
                'POST /documents/:id/process-llm',
                'POST /documents/:id/reprocess-llm',
                'POST /documents/:id/trim',
            ]);
            const unknown = registered.filter((route) => !tested.has(route) && !startsWork.has(route));

            expect(unknown).toEqual([]);

            await probe.close();
        });

        it('refuses the routes that start work on a closed folder’s document', async () => {
            const session = newSession();
            const id = world().docs.inLockedFolder;

            for (const [method, url] of [
                ['POST', '/documents/' + id + '/ocr'],
                ['POST', '/documents/' + id + '/ocr/retry'],
                ['POST', '/documents/' + id + '/process-llm'],
                ['POST', '/documents/' + id + '/reprocess-llm'],
                ['POST', '/documents/' + id + '/trim'],
            ] as const) {
                expect((await session.request(method, url, { start: 0, end: 1, saveAsCopy: false })).status, url).toBe(403);
            }
        });

        it('refuses jobs of a closed folder’s documents', async () => {
            const { db, docs } = world();
            const job = await db
                .insertInto('processing_jobs')
                .values({
                    user_id: world().alice,
                    job_type: 'ocr',
                    target_type: 'document',
                    target_id: docs.inLockedFolder,
                    status: 'complete',
                    priority: 0,
                    attempts: 1,
                    result: { secret: 'LOCKEDWORD' } as never,
                })
                .returning('id')
                .executeTakeFirstOrThrow();
            const session = newSession();
            const single = await session.get('/jobs/' + job.id);
            const batch = await session.get('/jobs/batch?ids=' + job.id);

            expect(single.status).toBe(403);
            expectNoPrivateData(single.raw);
            expect(batch.body).toEqual([]);

            await session.unlock(world().folders.lockedFolder.id);

            expect((await session.get('/jobs/' + job.id)).status).toBe(200);
        });
    });

    describe('moving things out', () => {
        it('refuses moving a document out of a closed folder, and moving into one', async () => {
            const { docs, folders } = world();
            const session = newSession();
            const out = await session.request('PATCH', '/documents/move', { document_ids: [docs.inLockedFolder], folder_id: folders.invoices.id });

            expect(out.status).toBe(403);
            expect(
                (await world().db.selectFrom('documents').select('folder_id').where('id', '=', docs.inLockedFolder).executeTakeFirstOrThrow()).folder_id,
            ).toBe(folders.lockedFolder.id);
        });

        it('makes a document private by moving it into a private folder, and lets it leave once the folder is open', async () => {
            const { alice, db, folders } = world();
            const id = await seedDocument(db, { userId: alice, name: 'mover.pdf', folderId: folders.invoices.id });
            const session = newSession();

            await session.unlock(folders.lockedFolder.id);
            expect((await session.request('PATCH', '/documents/move', { document_ids: [id], folder_id: folders.lockedFolder.id })).status).toBe(204);
            expect((await session.get('/documents/' + id)).body.is_private).toBe(true);
            expect((await session.request('PATCH', '/documents/move', { document_ids: [id], folder_id: folders.invoices.id })).status).toBe(204);
            expect((await session.get('/documents/' + id)).body.is_private).toBe(false);
        });

        it('refuses making a closed folder public or moving it, but lets a folder become private without any lock', async () => {
            const { folders } = world();
            const session = newSession();
            const unprivate = await session.request('PATCH', '/folders/' + folders.lockedFolder.id, { is_private: false });
            const reparent = await session.request('PATCH', '/folders/' + folders.lockedFolder.id, { parent_id: folders.work.id });
            const fresh = await seedFolder(world().db, world().alice, 'Becomes private', { parent: folders.work });
            const privatize = await session.request('PATCH', '/folders/' + fresh.id, { is_private: true });

            expect(unprivate.status).toBe(403);
            expect(reparent.status).toBe(403);
            expect(privatize.status).toBe(200);
            expect((await session.get('/documents?folder_id=' + fresh.id)).status).toBe(403);
        });

        it('moves a folder only with the lock it leaves and the lock it enters both open, and never into itself', async () => {
            const { alice, db, folders } = world();
            const source = await seedFolder(db, alice, 'Mover', { parent: await seedFolder(db, alice, 'Mover parent', { isPrivate: true }) });
            const inner = await seedFolder(db, alice, 'Mover inner', { parent: await seedFolder(db, alice, 'Mover mid', { parent: source }) });
            const sourceLock = (await db.selectFrom('folders').select('parent_id').where('id', '=', source.id).executeTakeFirstOrThrow()).parent_id!;
            const session = newSession();
            const move = (parentId: string) => session.request('PATCH', '/folders/' + source.id, { parent_id: parentId });

            await session.unlock(folders.lockedFolder.id);
            expect((await move(folders.lockedFolder.id)).status).toBe(403);
            await session.unlock(sourceLock);
            expect((await move(folders.vaultInner.id)).status).toBe(403);
            expect((await move(inner.id)).status).toBe(409);
            expect((await move(source.id)).status).toBe(409);
            expect((await move(folders.lockedFolder.id)).status).toBe(200);
        });

        /** A public folder with a private folder two levels down, which holds one document. */
        async function seedHidingFolder(name: string, opts: { trashed?: boolean } = {}) {
            const { alice, db } = world();
            const top = await seedFolder(db, alice, name);
            const middle = await seedFolder(db, alice, 'Middle', { parent: top });
            const hidden = await seedFolder(db, alice, 'Inside', { parent: middle, isPrivate: true, deleted: opts.trashed ?? false });

            await seedDocument(db, { userId: alice, name: name + '.pdf', folderId: hidden.id });

            return { top, hidden };
        }

        it('refuses a move into an opened folder that would open a closed lock beneath the moved one', async () => {
            const { db, folders } = world();
            const session = newSession();
            const move = (id: string) => session.request('PATCH', '/folders/' + id, { parent_id: folders.vault.id });

            await session.unlock(folders.vault.id);

            const refused = await move(folders.secretParent.id);

            expect(refused.status).toBe(403);
            expect(refused.body.error).toBe('FOLDER_LOCKED');
            expect((await session.get('/documents?folder_id=' + folders.lockedFolder.id)).status).toBe(403);
            expect(
                (await db.selectFrom('folders').select('parent_id').where('id', '=', folders.secretParent.id).executeTakeFirstOrThrow()).parent_id,
            ).toBeNull();
            // A lock on a trashed folder would open the same way.
            expect((await move((await seedHidingFolder('Hides trashed', { trashed: true })).top.id)).status).toBe(403);
        });

        it('moves a folder holding a closed lock anywhere public, and into an opened folder once that lock is open', async () => {
            const { folders } = world();
            const { top, hidden } = await seedHidingFolder('Travels');
            const session = newSession();
            const move = (parentId: string) => session.request('PATCH', '/folders/' + top.id, { parent_id: parentId });

            expect((await move(folders.work.id)).status).toBe(200);
            expect((await session.get('/documents?folder_id=' + hidden.id)).status).toBe(403);

            await session.unlock(folders.vault.id);
            await session.unlock(hidden.id);

            expect((await move(folders.vault.id)).status).toBe(200);
        });

        it('does not let a lock opened before reopen a closed one when the folder turns private again', async () => {
            const { top, hidden } = await seedHidingFolder('Flips');
            const session = newSession();
            const setPrivate = (isPrivate: boolean) => session.request('PATCH', '/folders/' + top.id, { is_private: isPrivate });

            // Anyone may make a public folder private, with a closed lock beneath it or not.
            expect((await setPrivate(true)).status).toBe(200);
            await session.unlock(top.id);
            expect((await setPrivate(false)).status).toBe(200);
            expect((await session.get('/documents?folder_id=' + hidden.id)).status).toBe(403);

            // The session still holds the folder's old lock, so turning it private again would cover and open the inner one.
            expect((await setPrivate(true)).status).toBe(403);
            expect((await session.get('/documents?folder_id=' + hidden.id)).status).toBe(403);
            expect((await newSession().request('PATCH', '/folders/' + top.id, { is_private: true })).status).toBe(200);
        });

        it('answers 404 for a change to a folder that does not exist, behind an opened lock too', async () => {
            const { folders } = world();
            const session = newSession();

            await session.unlock(folders.vault.id);

            expect((await session.request('PATCH', '/folders/' + crypto.randomUUID(), { parent_id: folders.vault.id })).status).toBe(404);
        });

        it('creates and reorders nothing inside a closed folder, at any depth', async () => {
            const { folders } = world();
            const session = newSession();
            const create = await session.request('POST', '/folders', { name: 'Sneaked in', parent_id: folders.vaultInner.id });
            const reorder = await session.request('PUT', '/folders/reorder', { updates: [{ id: folders.vaultInner.id, sort_order: 3 }] });

            expect(create.status).toBe(403);
            expect(reorder.status).toBe(403);
        });

        it('lets an opened folder become public', async () => {
            const { alice, db, folders } = world();
            const folder = await seedFolder(db, alice, 'Goes public', { parent: folders.work, isPrivate: true });
            const session = newSession();

            await session.unlock(folder.id);

            expect((await session.request('PATCH', '/folders/' + folder.id, { is_private: false })).status).toBe(200);
            expect((await newSession().get('/documents?folder_id=' + folder.id)).status).toBe(200);
        });
    });

    describe('trash', () => {
        it('keeps a trashed private folder’s documents private and hides its name until its lock is open, then restores it private', async () => {
            const { alice, db, folders } = world();
            const folder = await seedFolder(db, alice, 'Trashable secret', { parent: folders.work, isPrivate: true });
            const doc = await seedDocument(db, { userId: alice, name: 'trashable-secret.pdf', folderId: folder.id, ocrText: 'LOCKEDWORD' });

            await trashFolder(alice, folder.id);

            const row = await db.selectFrom('documents').select(['folder_id', 'deleted_at']).where('id', '=', doc).executeTakeFirstOrThrow();

            expect(row.folder_id).toBe(folder.id);
            expect(row.deleted_at).not.toBeNull();

            const closed = newSession();
            const listing = await closed.get('/trash');

            expect(listing.raw).not.toContain('Trashable secret');
            expect(listing.raw).not.toContain('trashable-secret.pdf');
            expect(listing.body.folders.find((f: { id: string }) => f.id === folder.id)).toMatchObject({ name: '', locked: true });
            expect((await closed.request('POST', '/trash/restore', { folder_ids: [folder.id] })).status).toBe(403);
            expect((await closed.request('POST', '/trash/purge', { folder_ids: [folder.id] })).status).toBe(403);
            expect((await closed.get('/documents')).raw).not.toContain('trashable-secret.pdf');

            const open = newSession();

            await open.unlock(folder.id);
            expect((await open.get('/trash')).body.folders.find((f: { id: string }) => f.id === folder.id)).toMatchObject({
                name: 'Trashable secret',
                locked: false,
            });
            expect((await open.request('POST', '/trash/restore', { folder_ids: [folder.id] })).status).toBe(200);

            const restored = await open.get('/documents?folder_id=' + folder.id);

            expect(restored.body.items.map((d: { id: string }) => d.id)).toEqual([doc]);
            expect((await newSession().get('/documents/' + doc)).status).toBe(403);
        });

        it('does not let emptying the trash destroy a closed folder’s items', async () => {
            const { alice, db, folders } = world();
            const folder = await seedFolder(db, alice, 'Survives empty', { parent: folders.work, isPrivate: true });
            const doc = await seedDocument(db, { userId: alice, name: 'survivor.pdf', folderId: folder.id });

            await trashFolder(alice, folder.id);
            expect((await newSession().request('DELETE', '/trash')).status).toBe(200);
            expect(await db.selectFrom('documents').select('id').where('id', '=', doc).executeTakeFirst()).toBeDefined();
            expect(await db.selectFrom('folders').select('id').where('id', '=', folder.id).executeTakeFirst()).toBeDefined();
        });

        it('purges a trashed private folder together with the documents deep beneath it instead of dropping them to the root', async () => {
            const { alice, db } = world();
            const collection = await seedFolder(db, alice, 'Purged vault', { isPrivate: true });
            const middle = await seedFolder(db, alice, 'Purged vault middle', { parent: collection });
            const inner = await seedFolder(db, alice, 'Purged vault inner', { parent: middle });
            const doc = await seedDocument(db, { userId: alice, name: 'purged-vault.pdf', folderId: inner.id });
            const session = newSession();

            await session.unlock(collection.id);
            await trashFolder(alice, collection.id);
            expect((await session.request('POST', '/trash/purge', { folder_ids: [collection.id] })).status).toBe(200);

            expect(await db.selectFrom('documents').select('id').where('id', '=', doc).executeTakeFirst()).toBeUndefined();
            expect(
                await db
                    .selectFrom('documents')
                    .select('id')
                    .where('user_id', '=', alice)
                    .where('folder_id', 'is', null)
                    .where('original_filename', '=', 'purged-vault.pdf')
                    .execute(),
            ).toEqual([]);
        });

        it('leaves a trashed public folder alone when a closed lock sits deep beneath it, on purge and on empty', async () => {
            const { alice, db } = world();
            const collection = await seedFolder(db, alice, 'Public shell');
            const middle = await seedFolder(db, alice, 'Shell middle', { parent: collection });
            const inner = await seedFolder(db, alice, 'Locked inside shell', { parent: middle, isPrivate: true });
            const doc = await seedDocument(db, { userId: alice, name: 'inside-shell.pdf', folderId: inner.id });

            await trashFolder(alice, collection.id);
            expect((await newSession().request('POST', '/trash/purge', { folder_ids: [collection.id] })).status).toBe(200);
            expect((await newSession().request('DELETE', '/trash')).status).toBe(200);

            const row = await db.selectFrom('documents').select('folder_id').where('id', '=', doc).executeTakeFirstOrThrow();

            expect(row.folder_id).toBe(inner.id);
            expect(await db.selectFrom('folders').select('id').where('id', '=', collection.id).executeTakeFirst()).toBeDefined();
            expect(await db.selectFrom('folders').select('id').where('id', '=', inner.id).executeTakeFirst()).toBeDefined();
        });

        it('trashes a private folder through the API without dropping its documents to the root', async () => {
            const { alice, db, folders } = world();
            const folder = await seedFolder(db, alice, 'Api trashed', { parent: folders.work, isPrivate: true });
            const doc = await seedDocument(db, { userId: alice, name: 'api-trashed.pdf', folderId: folder.id });
            const session = newSession();

            await session.unlock(folder.id);
            expect((await session.request('DELETE', '/folders/' + folder.id)).status).toBeLessThan(300);

            const row = await db.selectFrom('documents').select(['folder_id', 'deleted_at']).where('id', '=', doc).executeTakeFirstOrThrow();

            expect(row.folder_id).toBe(folder.id);
            expect(row.deleted_at).not.toBeNull();
            expect((await session.get('/documents')).raw).not.toContain('api-trashed.pdf');
        });
    });

    describe('tokens', () => {
        it('rejects the folder-lock cookie’s token as a bearer token', async () => {
            const session = newSession();

            await session.unlock(world().folders.lockedFolder.id);

            const replay = await app.inject({ method: 'GET', url: '/documents', headers: { authorization: 'Bearer ' + session.vaultCookie } });

            expect(session.vaultCookie).toBeTruthy();
            expect(replay.statusCode).toBe(401);
        });

        it('locks everything when the session logs out or locks', async () => {
            const { folders } = world();
            const session = newSession();

            await session.unlock(folders.lockedFolder.id);
            expect((await session.get('/documents?folder_id=' + folders.lockedFolder.id)).status).toBe(200);
            expect((await session.request('POST', '/auth/logout')).status).toBe(200);
            expect(session.vaultCookie).toBeUndefined();
            expect((await session.get('/documents?folder_id=' + folders.lockedFolder.id)).status).toBe(403);

            await session.unlock(folders.lockedFolder.id);
            await session.request('POST', '/vault/lock');
            expect((await session.get('/documents?folder_id=' + folders.lockedFolder.id)).status).toBe(403);
        });

        it('ignores a folder-lock cookie signed for another user', async () => {
            const { bob, db, folders } = world();
            const bobsPrivate = await seedFolder(db, bob, 'Bobs secret', { isPrivate: true });
            const alice = newSession();

            await alice.unlock(folders.lockedFolder.id);

            const replay = await app.inject({
                method: 'GET',
                url: '/documents?folder_id=' + bobsPrivate.id,
                headers: {
                    authorization: 'Bearer ' + app.jwt.sign({ sub: bob, email: 'b@example.test' } as never),
                    cookie: 'vault_session=' + alice.vaultCookie,
                },
            });

            expect(replay.statusCode).toBe(403);
        });
    });

    describe('users without a password', () => {
        it('cannot unlock, and has nothing locked', async () => {
            const { db } = world();
            const nopass = await db
                .insertInto('users')
                .values({
                    email: 'nopass@example.test',
                    display_name: 'nopass',
                    password_hash: null,
                    google_id: 'g-1',
                    storage_quota_bytes: 1,
                    storage_path: '/nopass',
                    last_login_at: null,
                })
                .returning('id')
                .executeTakeFirstOrThrow();
            const folder = await seedFolder(db, nopass.id, 'Mine', { isPrivate: true });
            const session = new Session(app, app.jwt.sign({ sub: nopass.id, email: 'nopass@example.test' } as never));

            expect((await session.get('/vault/status')).body).toEqual({ unlocked: false, has_password: false });
            expect((await session.unlock(folder.id)).status).toBe(400);
            expect((await session.get('/documents?folder_id=' + folder.id)).status).toBe(200);
        });
    });
});

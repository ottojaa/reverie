import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import type { DuplicateGroup } from '@reverie/shared';
import authPlugin from '../app/plugins/auth.js';
import errorHandler from '../app/plugins/error-handler.js';
import duplicatesRoute from '../app/routes/duplicates.route.js';
import trashRoute from '../app/routes/trash.route.js';
import vaultRoute from '../app/routes/vault.route.js';
import { env } from '../config/env.js';
import { toVectorLiteral } from '../embeddings/embedding.repository';
import { createAuthService } from '../services/auth.service.js';
import { IMAGE_DIMENSIONS, IMAGE_MODEL, leaning } from '../testing/fake-ml.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import { loadScanConfig, scanDuplicates } from './scan';

const PASSWORD = 'correct horse battery staple';
const THRESHOLD = env.DUPLICATE_MIN_SIMILARITY;

/**
 * An image vector `fraction` of the way (as an angle) from the first image to the threshold: 0 is the same picture as the first image,
 * 1 sits exactly at the threshold. Two vectors are as similar as their angle apart allows, so tests state distances in units of
 * "threshold" and keep passing whatever the configured threshold is.
 */
const at = (fraction: number) => leaning(IMAGE_DIMENSIONS, 0, Math.cos(fraction * Math.acos(THRESHOLD)));

describeDb('duplicate groups', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let counter = 0;

    const world = (): World => ctx.world();
    const db = () => world().db;
    const sessionOf = (userId: string) => app.jwt.sign({ sub: userId, email: 'x@example.test' } as never);

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        for (const route of [duplicatesRoute, trashRoute, vaultRoute]) await app.register(route);
        await app.ready();

        const hash = await createAuthService(app).hashPassword(PASSWORD);

        await db().updateTable('users').set({ password_hash: hash }).execute();
    }, 60_000);
    afterAll(() => app.close());

    /** A call as `userId`; `cookie` carries an unlocked folder. */
    async function call(userId: string, method: 'GET' | 'POST', url: string, payload?: object, cookie?: string) {
        const response = await app.inject({
            method,
            url,
            payload,
            headers: { authorization: 'Bearer ' + sessionOf(userId), ...(cookie ? { cookie } : {}) },
        });

        return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
    }

    const newUser = () => seedUser(db(), 'dupe-owner-' + ++counter);

    /** An image of `owner` with a stored embedding (none when `vector` is omitted), already scanned for neighbours. */
    async function image(
        owner: string,
        vector?: number[],
        opts: { folderId?: string | null; deleted?: boolean; hash?: string; name?: string; scan?: boolean } = {},
    ) {
        const id = await seedDocument(db(), {
            userId: owner,
            name: opts.name ?? 'img-' + ++counter + '.jpg',
            mime: 'image/jpeg',
            folderId: opts.folderId ?? null,
            deleted: opts.deleted,
            hash: opts.hash,
        });

        if (vector) {
            await db()
                .insertInto('document_image_embeddings')
                .values({
                    document_id: id,
                    content_hash: 'h',
                    model: IMAGE_MODEL.name,
                    model_version: IMAGE_MODEL.revision,
                    embedding: toVectorLiteral(vector),
                })
                .execute();

            if (opts.scan !== false) await scanDuplicates(id, loadScanConfig());
        }

        return id;
    }

    const groupsOf = async (userId: string, query = ''): Promise<string[][]> => {
        const response = await call(userId, 'GET', '/duplicates' + query);

        expect(response.status).toBe(200);

        return (response.body.groups as DuplicateGroup[]).map((group) => group.members.map((member) => member.id).sort());
    };

    describe('grouping', () => {
        it('groups images at or above the threshold and leaves a clearly different one out', async () => {
            const me = await newUser();
            const a = await image(me, at(0));
            const b = await image(me, at(0.5));
            const different = await image(me, at(3));

            expect(await groupsOf(me)).toEqual([[a, b].sort()]);
            expect(await groupsOf(me)).not.toContainEqual(expect.arrayContaining([different]));
        });

        it('keeps a pair just below the threshold apart and joins a pair just above it', async () => {
            const me = await newUser();
            const first = await image(me, at(0));
            const above = await image(me, at(0.95));

            expect(await groupsOf(me)).toEqual([[first, above].sort()]);

            const other = await newUser();

            await image(other, at(0));
            await image(other, at(1.05));

            expect(await groupsOf(other)).toEqual([]);
        });

        it('does not chain: A~B and B~C without A~C make {A,B} and C alone, never {A,B,C}', async () => {
            const me = await newUser();
            const a = await image(me, at(0));
            const b = await image(me, at(0.6));
            const c = await image(me, at(1.2));
            const groups = await groupsOf(me);

            expect(groups).toHaveLength(1);
            expect(groups[0]).toHaveLength(2);
            expect(groups[0]).not.toEqual(expect.arrayContaining([a, c]));
            expect(groups[0]).toContain(b);
        });

        it('groups identical files by their hash, with or without an embedding, and reports them as exact', async () => {
            const me = await newUser();
            const hash = 'same-bytes-' + ++counter;
            const first = await image(me, undefined, { hash });
            const second = await image(me, undefined, { hash });
            const response = await call(me, 'GET', '/duplicates');

            expect(response.body.groups).toHaveLength(1);
            expect(response.body.groups[0].members.map((m: { id: string }) => m.id).sort()).toEqual([first, second].sort());
            expect(response.body.groups[0].min_similarity).toBe(1);
        });

        it('does not group a document that is not an image even when its file is a copy', async () => {
            const me = await newUser();
            const hash = 'pdf-bytes-' + ++counter;

            for (const name of ['a.pdf', 'b.pdf']) await seedDocument(db(), { userId: me, name, hash });

            expect(await groupsOf(me)).toEqual([]);
        });

        it('splits a burst whose pairs were cut by the neighbour cap, and one rescan with a bigger cap joins it', async () => {
            const me = await newUser();
            const ids: string[] = [];

            // Four near-identical shots, each scanned keeping only its two nearest: the outermost two never see each other.
            for (let i = 0; i < 4; i++) ids.push(await image(me, at(0.01 * i), { scan: false }));

            for (const id of ids) await scanDuplicates(id, { ...loadScanConfig(), maxNeighbours: 2 });

            expect(Math.max(...(await groupsOf(me)).map((group) => group.length))).toBeLessThan(4);

            for (const id of ids) await scanDuplicates(id, loadScanConfig());

            expect(await groupsOf(me)).toEqual([ids.slice().sort()]);
        });
    });

    describe('what is never grouped', () => {
        it('leaves other users’ images alone: a lookalike in another account is not my duplicate', async () => {
            const me = await newUser();
            const them = await newUser();

            await image(me, at(0));
            await image(them, at(0.1));

            expect(await groupsOf(me)).toEqual([]);
            expect(await groupsOf(them)).toEqual([]);
        });

        it('does not pair images with the same hash across accounts', async () => {
            const me = await newUser();
            const them = await newUser();
            const hash = 'shared-' + ++counter;

            await image(me, undefined, { hash });
            await image(them, undefined, { hash });

            expect(await groupsOf(me)).toEqual([]);
        });

        it('leaves trashed images out, and a restored one rejoins its group', async () => {
            const me = await newUser();
            const a = await image(me, at(0));
            const b = await image(me, at(0.3));
            const trashed = await image(me, at(0.4));

            expect(await groupsOf(me)).toEqual([[a, b, trashed].sort()]);

            await db().updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', trashed).execute();

            expect(await groupsOf(me)).toEqual([[a, b].sort()]);

            await db().updateTable('documents').set({ deleted_at: null }).where('id', '=', trashed).execute();

            expect(await groupsOf(me)).toEqual([[a, b, trashed].sort()]);
        });

        it('leaves a trashed exact copy out', async () => {
            const me = await newUser();
            const hash = 'trash-hash-' + ++counter;

            await image(me, undefined, { hash });
            await image(me, undefined, { hash, deleted: true });

            expect(await groupsOf(me)).toEqual([]);
        });
    });

    describe('private folders', () => {
        const unlock = async (folderId: string) => {
            const response = await app.inject({
                method: 'POST',
                url: '/vault/unlock',
                payload: { password: PASSWORD, folder_id: folderId },
                headers: { authorization: 'Bearer ' + sessionOf(world().alice) },
            });
            const [pair = ''] = String(response.headers['set-cookie']).split(';');

            return pair;
        };

        it('never lists a private image in the public list, and groups it only with images behind the same lock', async () => {
            const { alice, folders } = world();
            const publicA = await image(alice, at(0));
            const publicB = await image(alice, at(0.2));
            const vaultImage = await image(alice, at(0.1), { folderId: folders.vault.id });
            const vaultInnerImage = await image(alice, at(0.3), { folderId: folders.vaultInner.id });
            await image(alice, at(0.15), { folderId: folders.lockedFolder.id });

            // Public list: only the two public images, though all five look alike.
            expect(await groupsOf(alice)).toEqual([[publicA, publicB].sort()]);

            const vaultCookie = await unlock(folders.vault.id);
            const hiddenCookie = await unlock(folders.lockedFolder.id);
            const vaultList = await call(alice, 'GET', '/duplicates?folder_id=' + folders.vaultInner.id, undefined, vaultCookie);
            const ids = (vaultList.body.groups as DuplicateGroup[]).flatMap((group) => group.members.map((member) => member.id)).sort();

            // The private collection and its folder share one lock, so they group together; nothing outside it joins.
            expect(ids).toEqual([vaultImage, vaultInnerImage].sort());

            const hiddenList = await call(alice, 'GET', '/duplicates?folder_id=' + folders.lockedFolder.id, undefined, hiddenCookie);

            // The other private folder is its own lock: its single image has nothing to group with.
            expect(hiddenList.body.groups).toEqual([]);
        });

        it('refuses a closed private folder, and a folder that is not private', async () => {
            const { alice, folders } = world();
            const closed = await call(alice, 'GET', '/duplicates?folder_id=' + folders.vault.id);
            const notPrivate = await call(alice, 'GET', '/duplicates?folder_id=' + folders.work.id);

            expect(closed.status).toBe(403);
            expect(closed.body.error).toBe('FOLDER_LOCKED');
            expect(notPrivate.status).toBe(400);
        });
    });

    describe('trashing the others', () => {
        async function threeCopies() {
            const me = await newUser();
            const ids = [await image(me, at(0)), await image(me, at(0.2)), await image(me, at(0.4))];
            const [group] = (await call(me, 'GET', '/duplicates')).body.groups as DuplicateGroup[];

            return { me, ids, group: group! };
        }

        const trashedIds = async (ids: string[]) =>
            (await db().selectFrom('documents').select('id').where('id', 'in', ids).where('deleted_at', 'is not', null).execute()).map((row) => row.id).sort();

        it('keeps the chosen image and trashes the rest, and the restore the web’s undo calls brings them back', async () => {
            const { me, ids, group } = await threeCopies();
            const keep = ids[1]!;
            const trashed = await call(me, 'POST', '/duplicates/trash-others', { groups: [{ group_id: group.id, keep_id: keep }] });

            expect(trashed.status).toBe(200);
            expect(trashed.body.trashed_ids.sort()).toEqual(ids.filter((id) => id !== keep).sort());
            expect(await trashedIds(ids)).toEqual(ids.filter((id) => id !== keep).sort());
            expect(await groupsOf(me)).toEqual([]);

            const restored = await call(me, 'POST', '/trash/restore', { document_ids: trashed.body.trashed_ids, folder_ids: [] });

            expect(restored.status).toBe(200);
            expect(await trashedIds(ids)).toEqual([]);
            expect(await groupsOf(me)).toEqual([ids.slice().sort()]);
        });

        it('skips a keep_id that is not in the group, and a group that does not exist, and trashes nothing for them', async () => {
            const { me, ids, group } = await threeCopies();
            const stranger = await image(me, at(9));
            const response = await call(me, 'POST', '/duplicates/trash-others', {
                groups: [
                    { group_id: group.id, keep_id: stranger },
                    { group_id: 'f'.repeat(24), keep_id: ids[0] },
                ],
            });

            expect(response.body.trashed_ids).toEqual([]);
            expect(response.body.skipped_group_ids.sort()).toEqual([group.id, 'f'.repeat(24)].sort());
            expect(await trashedIds([...ids, stranger])).toEqual([]);
        });

        it('trashes every group in one call', async () => {
            const me = await newUser();
            const first = [await image(me, at(0)), await image(me, at(0.1))];
            const second = [await image(me, leaning(IMAGE_DIMENSIONS, 7, 1)), await image(me, leaning(IMAGE_DIMENSIONS, 7, 0.9999999))];
            const groups = (await call(me, 'GET', '/duplicates')).body.groups as DuplicateGroup[];

            expect(groups).toHaveLength(2);

            const response = await call(me, 'POST', '/duplicates/trash-others', {
                groups: groups.map((group) => ({ group_id: group.id, keep_id: group.suggested_keep_id })),
            });

            expect(response.body.trashed_ids).toHaveLength(2);
            expect(await trashedIds([...first, ...second])).toHaveLength(2);
            expect(await groupsOf(me)).toEqual([]);
        });

        it('cannot trash another user’s images', async () => {
            const { ids, group } = await threeCopies();
            const intruder = await newUser();
            const response = await call(intruder, 'POST', '/duplicates/trash-others', { groups: [{ group_id: group.id, keep_id: ids[0] }] });

            expect(response.body.trashed_ids).toEqual([]);
            expect(await trashedIds(ids)).toEqual([]);
        });
    });

    describe('suggesting the copy to keep', () => {
        it('prefers the largest resolution, then an original over an edited copy, then the oldest', async () => {
            const me = await newUser();
            const original = await image(me, at(0), { name: 'IMG_1.jpg' });
            const edited = await image(me, at(0.1), { name: 'IMG_1 (Copy).jpg' });
            const bigger = await image(me, at(0.2), { name: 'IMG_1 big.jpg' });

            await db().updateTable('documents').set({ width: 4000, height: 3000 }).where('id', 'in', [original, edited]).execute();
            await db().updateTable('documents').set({ width: 6000, height: 4000 }).where('id', '=', bigger).execute();

            const [group] = (await call(me, 'GET', '/duplicates')).body.groups as DuplicateGroup[];

            expect(group!.suggested_keep_id).toBe(bigger);

            await db().updateTable('documents').set({ width: 4000, height: 3000 }).where('id', '=', bigger).execute();

            // Same size everywhere now: the edited copy loses, and the oldest of the originals wins.
            const [again] = (await call(me, 'GET', '/duplicates')).body.groups as DuplicateGroup[];

            expect(again!.suggested_keep_id).toBe(original);
        });
    });

    describe('"not duplicates"', () => {
        it('keeps a dismissed group out for good, through a rescan and a restart of the list', async () => {
            const me = await newUser();
            const ids = [await image(me, at(0)), await image(me, at(0.2))];
            const [group] = (await call(me, 'GET', '/duplicates')).body.groups as DuplicateGroup[];
            const dismissed = await call(me, 'POST', '/duplicates/dismiss', { group_id: group!.id });

            expect(dismissed.body).toEqual({ dismissed: true });
            expect(await groupsOf(me)).toEqual([]);

            for (const id of ids) await scanDuplicates(id, loadScanConfig());

            expect(await groupsOf(me)).toEqual([]);
            expect((await call(me, 'POST', '/duplicates/dismiss', { group_id: group!.id })).status).toBe(404);
        });

        it('dismisses an exact-copy group the same way', async () => {
            const me = await newUser();
            const hash = 'dismiss-' + ++counter;

            await image(me, undefined, { hash });
            await image(me, undefined, { hash });

            const [group] = (await call(me, 'GET', '/duplicates')).body.groups as DuplicateGroup[];

            await call(me, 'POST', '/duplicates/dismiss', { group_id: group!.id });

            expect(await groupsOf(me)).toEqual([]);
        });
    });

    describe('the scan', () => {
        it('replaces an image’s pairs on a rescan and records the threshold it ran at', async () => {
            const me = await newUser();
            await image(me, at(0));

            const b = await image(me, at(0.2));

            expect(
                await db()
                    .selectFrom('duplicate_edges')
                    .select('doc_a')
                    .where((eb) => eb.or([eb('doc_a', '=', b), eb('doc_b', '=', b)]))
                    .execute(),
            ).toHaveLength(1);

            await db()
                .updateTable('document_image_embeddings')
                .set({ embedding: toVectorLiteral(at(5)) })
                .where('document_id', '=', b)
                .execute();
            await scanDuplicates(b, loadScanConfig());

            expect(
                await db()
                    .selectFrom('duplicate_edges')
                    .select('doc_a')
                    .where((eb) => eb.or([eb('doc_a', '=', b), eb('doc_b', '=', b)]))
                    .execute(),
            ).toHaveLength(0);

            const scan = await db().selectFrom('document_duplicate_scans').select('threshold').where('document_id', '=', b).executeTakeFirstOrThrow();

            expect(scan.threshold).toBe(THRESHOLD);
            expect(await groupsOf(me)).toEqual([]);
        });

        it('stores nothing for an image without an embedding', async () => {
            const me = await newUser();
            const id = await image(me);

            expect(await scanDuplicates(id, loadScanConfig())).toBeNull();
        });
    });
});

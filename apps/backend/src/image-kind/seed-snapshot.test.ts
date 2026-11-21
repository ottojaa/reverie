import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const parse = vi.hoisted(() => vi.fn());

vi.mock('exifr', () => ({ default: { parse } }));
vi.mock('@webkitty/geo-rev', () => ({ createRevGeocoder: async () => ({ lookup: () => null }) }));

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { upsertImageEmbedding } from '../embeddings/embedding.repository';
import { createFakeMl, IMAGE_DIMENSIONS, IMAGE_MODEL, unit, type FakeMl } from '../testing/fake-ml.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { KIND_CLASSIFIER } from './classifier-config';
import { findDocumentsMissingKind, loadStoredKind } from './kind.repository';
import { snapshotSeedSet } from './seed-snapshot';
import { hasSeedSet, loadSeedSet } from './seed-set.repository';
import { clearPromptCache } from './prompt-cache';
import { classifyDocumentImage } from './service';

const MODEL = { model: IMAGE_MODEL.name, version: IMAGE_MODEL.revision };
const VERSION = KIND_CLASSIFIER.version;

describeDb('the seed set of the committed classifier', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let ml: FakeMl;
    let axis: number;

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        userId = await seedUser(db, 'owner');
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });
    beforeEach(async () => {
        await db.deleteFrom('documents').execute();
        await db.deleteFrom('image_kind_seed_sets').execute();
        clearPromptCache();
        ml = createFakeMl();
        axis = 10;
        parse.mockReset();
        parse.mockImplementation(async (buffer: Buffer) => (buffer.toString().includes('camera') ? { Make: 'Apple', Model: 'iPhone' } : undefined));
    });

    const readFile = async (path: string) => Buffer.from(path);

    /** Each image sits on an axis of its own, so no two are near-duplicates. */
    async function seedImage(name: string, extra: Partial<Parameters<typeof seedDocument>[1]> = {}, read = true) {
        const id = await seedDocument(db, { userId, name, mime: 'image/jpeg', ...extra });

        await upsertImageEmbedding(db, id, 'hash', MODEL, unit(IMAGE_DIMENSIONS, axis++));

        if (read) await db.updateTable('documents').set({ camera_read_at: new Date() }).where('id', '=', id).execute();

        return id;
    }

    async function seedLibrary() {
        const ids = { photo: [] as string[], screenshot: [] as string[], document: [] as string[], other: [] as string[] };

        for (const n of [1, 2, 3]) ids.photo.push(await seedImage(`camera-${n}.jpg`));

        for (const n of [1, 2, 3]) ids.screenshot.push(await seedImage(`Screenshot_${n}.png`));

        for (const n of [1, 2, 3]) ids.document.push(await seedImage(`statement-${n}.jpg`, { category: 'bank_statement', ocrText: 'SECRET WORDS' }));

        ids.other.push(await seedImage('mystery.jpg'));

        return ids;
    }

    const snapshot = (replace = false) => snapshotSeedSet({ db, ml, readFile }, { replace });
    const countRows = async () => ({
        documents: await db.selectFrom('documents').selectAll().orderBy('id').execute(),
        metadata: await db.selectFrom('photo_metadata').selectAll().orderBy('document_id').execute(),
        kinds: await db.selectFrom('document_image_kinds').selectAll().orderBy('document_id').execute(),
    });

    it('classifies nothing before the snapshot: no verdict, and the backfill finds nothing to do', async () => {
        const ids = await seedLibrary();

        expect(await classifyDocumentImage({ db, ml }, ids.photo[0]!)).toEqual({ outcome: 'no-seed-set' });
        expect(await loadStoredKind(db, ids.photo[0]!)).toBeNull();
        expect(await findDocumentsMissingKind(db, MODEL, null, 100)).toEqual([]);
    });

    it('stores the seeds of every kind that has enough of them and prints counts only', async () => {
        const ids = await seedLibrary();
        const lines = await snapshot();
        const set = await loadSeedSet(db, VERSION, MODEL);

        expect(lines.join('\n')).toMatch(/photo\s+3 seed\(s\)/);
        expect(lines.join('\n')).not.toContain('SECRET');
        expect(lines.join('\n')).not.toContain(ids.photo[0]!);
        expect(set?.seeds.map((seed) => seed.id).sort()).toEqual([...ids.photo, ...ids.screenshot, ...ids.document].sort());
        expect(set?.stats.scored).toEqual(['photo', 'screenshot', 'document']);
    });

    it('writes only the seed tables: documents, photo metadata and verdicts are the same after it', async () => {
        await seedLibrary();

        const before = await countRows();

        await snapshot();

        expect(await countRows()).toEqual(before);
    });

    it('refuses while an image has not had its camera columns read, because the runtime would not see what the snapshot saw', async () => {
        await seedLibrary();
        await seedImage('unread.jpg', {}, false);

        await expect(snapshot()).rejects.toThrow('The camera backfill has not read every image yet: 1 left');
        expect(await hasSeedSet(db, VERSION, MODEL)).toBe(false);
    });

    it('refuses a second snapshot of the same version unless asked to replace it', async () => {
        await seedLibrary();
        await snapshot();

        await expect(snapshot()).rejects.toThrow('A seed set already exists for this classifier version');
        await expect(snapshot(true)).resolves.toBeDefined();
    });

    it('lets the backfill and the classifier work once the set exists, and stores the version on the verdict', async () => {
        const ids = await seedLibrary();

        await snapshot();

        expect((await findDocumentsMissingKind(db, MODEL, null, 100)).sort()).toEqual(Object.values(ids).flat().sort());
        expect(await classifyDocumentImage({ db, ml }, ids.photo[0]!)).toMatchObject({ outcome: 'classified' });
        expect((await loadStoredKind(db, ids.photo[0]!))?.promptVersion).toBe(VERSION);
        expect(await findDocumentsMissingKind(db, MODEL, null, 100)).not.toContain(ids.photo[0]);
    });

    it('replacing the set deletes that version’s verdicts, so the backfill classifies them again', async () => {
        const ids = await seedLibrary();

        await snapshot();
        await classifyDocumentImage({ db, ml }, ids.photo[0]!);
        await snapshot(true);

        expect(await loadStoredKind(db, ids.photo[0]!)).toBeNull();
        expect(await findDocumentsMissingKind(db, MODEL, null, 100)).toContain(ids.photo[0]);
    });

    it('drops a seed whose document is deleted out of the set, without moving the frozen statistics', async () => {
        const ids = await seedLibrary();

        await snapshot();

        const before = await loadSeedSet(db, VERSION, MODEL);

        await db.updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', ids.photo[0]!).execute();

        const softDeleted = await loadSeedSet(db, VERSION, MODEL);

        expect(softDeleted?.seeds.map((seed) => seed.id)).not.toContain(ids.photo[0]);
        expect(softDeleted?.seeds).toHaveLength((before?.seeds.length ?? 0) - 1);
        expect(softDeleted?.stats).toEqual(before?.stats);

        await db.deleteFrom('documents').where('id', '=', ids.screenshot[0]!).execute();

        expect((await loadSeedSet(db, VERSION, MODEL))?.seeds).toHaveLength((before?.seeds.length ?? 0) - 2);
        expect(await db.selectFrom('image_kind_seeds').select('document_id').where('document_id', '=', ids.screenshot[0]!).execute()).toEqual([]);
    });

    it('has no set for another image model: nothing is classified with seeds embedded by a different model', async () => {
        await seedLibrary();
        await snapshot();

        expect(await loadSeedSet(db, VERSION, { model: 'other-model', version: 'x' })).toBeNull();
        expect(await hasSeedSet(db, VERSION, { model: MODEL.model, version: 'rev-2' })).toBe(false);
    });
});

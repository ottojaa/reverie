import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { IMAGE_KINDS } from './kinds';
import { parsePromptSet } from './prompt-set';
import { runTuning } from './tune-runner';

const MODEL = { model: IMAGE_MODEL.name, version: IMAGE_MODEL.revision };

// One prompt per kind, so the fake ml embeds them to unit vectors 0..5 in kind order: an image embedded to unit(n)
// matches exactly the nth kind.
const prompts = Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, [`a ${kind}`]]));
const SET = {
    name: 'test-set',
    aggregate: 'max',
    calibration: 'none',
    thresholds: { cameraPrior: 0.03, screenPrior: 0.03, margin: 0.02, paperOnCameraMargin: 0.04 },
    prompts,
    margins: [0.5, 5],
};

const parseSet = () => parsePromptSet(SET);

describeDb('the tuning run', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let ml: FakeMl;

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
        ml = createFakeMl();
        parse.mockReset();
        // The stored file's name says what its EXIF holds.
        parse.mockImplementation(async (buffer: Buffer) => {
            const name = buffer.toString();

            if (name.includes('camera')) return { Make: 'Apple', Model: 'iPhone' };

            if (name.includes('date-only')) return { DateTimeOriginal: new Date('2026-01-02T00:00:00Z') };

            return undefined;
        });
    });

    const readFile = async (path: string) => {
        if (path.includes('missing')) throw Object.assign(new Error('no such file'), { code: 'ENOENT' });

        return Buffer.from(path);
    };

    async function seedImage(name: string, kindIndex: number, extra: Partial<Parameters<typeof seedDocument>[1]> = {}, model = MODEL) {
        const id = await seedDocument(db, { userId, name, mime: 'image/jpeg', ...extra });

        await upsertImageEmbedding(db, id, 'hash', model, unit(IMAGE_DIMENSIONS, kindIndex));

        return id;
    }

    async function tune(sets: unknown[] = [SET]): Promise<string> {
        let out = '';

        await runTuning({ db, ml, readFile }, sets.map(parsePromptSet), (text) => void (out += text));

        return out;
    }

    const snapshot = async () => ({
        documents: await db.selectFrom('documents').selectAll().orderBy('id').execute(),
        metadata: await db.selectFrom('photo_metadata').selectAll().orderBy('document_id').execute(),
        kinds: await db.selectFrom('document_image_kinds').selectAll().orderBy('document_id').execute(),
    });

    it('prints the table, both privacy lists, the bar, the stats and the margin grid for each set', async () => {
        await seedImage('plain-photo.jpg', 0, { category: 'photo' });
        await seedImage('shot.png', 1, { category: 'screenshot' });
        await seedImage('statement.jpg', 2, { category: 'bank_statement', ocrText: 'SECRET WORDS' });

        const out = await tune([SET, { ...SET, name: 'second-set', aggregate: 'mean' }]);

        expect(out).toContain('Tuning 2 prompt set(s) over 3 image(s)');
        expect(out).toContain('Prompt set: test-set');
        expect(out).toContain('Prompt set: second-set');
        expect(out).toContain('verdict \\ category');
        expect(out).toContain('PRIVACY 1:');
        expect(out).toContain('PRIVACY 2:');
        expect(out).toContain('Flip bar:');
        expect(out).toContain('mean=');
        expect(out).toContain('margin 0.5');
        expect(out).toContain('margin 5');
        expect(out).toContain('[pass] statements, invoices, forms and letters read as document: 1 of 1');
        expect(out).not.toContain('SECRET');
    });

    it('applies the EXIF read from the stored file: camera evidence makes a paper verdict a privacy-list entry, a lone date does not', async () => {
        await seedImage('camera-paper.jpg', 2, { category: 'photo' });
        await seedImage('date-only-shot.jpg', 1, { category: 'screenshot' });

        const out = await tune();
        const privacy = out.slice(out.indexOf('PRIVACY 1:'), out.indexOf('PRIVACY 2:'));

        expect(privacy).toContain('non-photo verdict: 1');
        expect(privacy).toContain('camera-paper.jpg');
        expect(privacy).not.toContain('date-only-shot.jpg');
        expect(out).toContain('Date only: 1 verdict(s)');
    });

    it('keeps the stored camera columns when the file cannot be read, and counts the unreadable file', async () => {
        await seedImage('missing-photo.jpg', 2, { category: 'photo', photo: { cameraMake: 'Apple' } });

        const out = await tune();

        expect(out).toContain('file unreadable: 1');
        expect(out).toContain('non-photo verdict: 1');
    });

    it('leaves out images embedded by another image model, and says how many', async () => {
        await seedImage('current.jpg', 0, { category: 'photo' });
        await seedImage('old-model.jpg', 0, { category: 'photo' }, { model: 'old', version: 'x' });

        const out = await tune();

        expect(out).toContain('over 1 image(s)');
        expect(out).toContain('left out (embedded by another image model): 1');
    });

    it('writes nothing: documents, photo metadata and verdicts are the same after a run', async () => {
        await seedImage('camera-paper.jpg', 2, { category: 'photo' });
        await seedImage('shot.png', 1, { category: 'screenshot' });

        const before = await snapshot();

        await tune();

        expect(await snapshot()).toEqual(before);
        expect(before.documents.every((document) => document.camera_read_at === null)).toBe(true);
    });

    it('asks reverie-ml for the prompt texts of each set and nothing else', async () => {
        await seedImage('a.jpg', 0, { category: 'photo' });
        await tune();

        expect(ml.imageTextCalls).toEqual([IMAGE_KINDS.map((kind) => `a ${kind}`)]);
        expect(ml.imageCalls).toBe(0);
    });

    describe('a prototype set', () => {
        const PROTOTYPES = { ...SET, name: 'proto-set', prototypes: { method: 'centroid', promptWeight: 0 } };

        async function seedLibrary() {
            for (const n of [1, 2, 3]) await seedImage(`camera-${n}.jpg`, 0);

            for (const n of [1, 2, 3]) await seedImage(`Screenshot_${n}.png`, 1);

            for (const n of [1, 2, 3]) await seedImage(`statement-${n}.jpg`, 2, { category: 'bank_statement', ocrText: 'SECRET WORDS' });

            await seedImage('mystery.jpg', 1);
        }

        it('prints the seeds it found and needs no prompt texts when the prompts are left out', async () => {
            await seedLibrary();

            const out = await tune([PROTOTYPES]);

            expect(out).toContain('Prototypes, leave-one-out (centroid, prompt weight 0)');
            expect(out).toMatch(/photo\s+3 seed\(s\)/);
            expect(out).toMatch(/screenshot\s+3 seed\(s\)/);
            expect(out).toMatch(/document\s+3 seed\(s\)/);
            expect(out).toMatch(/receipt\s+0 seed\(s\)\s+\(fewer than 3/);
            expect(out).toContain('Flip bar:');
            expect(ml.imageTextCalls).toEqual([]);
        });

        it('asks for the prompt texts when they get a weight, and writes nothing', async () => {
            await seedLibrary();

            const before = await snapshot();

            await tune([{ ...PROTOTYPES, prototypes: { method: 'knn', k: 2, ks: [1], promptWeight: 0.5, promptWeights: [0.25] } }]);

            expect(ml.imageTextCalls).toEqual([IMAGE_KINDS.map((kind) => `a ${kind}`)]);
            expect(await snapshot()).toEqual(before);
        });
    });

    it('classifies nothing when no stored embedding is from the model reverie-ml serves now', async () => {
        await seedImage('a.jpg', 0, { category: 'photo' });
        ml.setImageRevision('rev-2');

        expect(await tune()).toContain('over 0 image(s)');
    });

    it('issues no insert, update or delete, and reads inside a READ ONLY transaction', async () => {
        await seedImage('camera-paper.jpg', 2, { category: 'photo' });

        const statements: { kind: string; sql: string }[] = [];
        const watched = db.withPlugin({
            transformQuery: ({ node }) => {
                const fragments = 'sqlFragments' in node ? (node.sqlFragments as string[]).join('?') : '';

                statements.push({ kind: node.kind, sql: fragments });

                return node;
            },
            transformResult: async ({ result }) => result,
        });

        await runTuning({ db: watched, ml, readFile }, [parseSet()], () => undefined);

        expect(statements.some((statement) => statement.sql.includes('SET TRANSACTION READ ONLY'))).toBe(true);
        expect(statements.map((statement) => statement.kind)).not.toContain('InsertQueryNode');
        expect(statements.map((statement) => statement.kind)).not.toContain('UpdateQueryNode');
        expect(statements.map((statement) => statement.kind)).not.toContain('DeleteQueryNode');
        expect(statements.some((statement) => statement.kind === 'SelectQueryNode')).toBe(true);
    });
});

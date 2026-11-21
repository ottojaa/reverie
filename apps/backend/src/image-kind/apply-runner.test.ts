import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { upsertImageEmbedding } from '../embeddings/embedding.repository';
import { IMAGE_DIMENSIONS, IMAGE_MODEL } from '../testing/fake-ml.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { planChanges, runApply, toHeuristicCategory, type ApplyRow } from './apply-runner';
import { upsertKind } from './kind.repository';
import type { ImageKind } from './kinds';

const MODEL = { model: IMAGE_MODEL.name, version: IMAGE_MODEL.revision };

function row(overrides: Partial<ApplyRow>): ApplyRow {
    return {
        id: 'a',
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        width: null,
        height: null,
        category: null,
        hasMeaningfulText: false,
        kind: null,
        ...overrides,
    };
}

it('maps each kind to its category over a missing or heuristic one, and leaves an LLM-chosen category alone', () => {
    const rows = [
        row({ id: '1', category: 'other', kind: 'screenshot' }),
        row({ id: '2', category: null, kind: 'diagram' }),
        row({ id: '3', category: 'screenshot', kind: 'photo' }),
        row({ id: '4', category: 'invoice', kind: 'photo' }),
        row({ id: '5', category: 'photo', kind: null }),
        row({ id: '6', category: 'screenshot', kind: 'screenshot' }),
    ];

    expect(planChanges(rows, 'apply')).toEqual([
        { id: '1', from: 'other', to: 'screenshot' },
        { id: '2', from: null, to: 'graphic' },
        { id: '3', from: 'screenshot', to: 'photo' },
    ]);
});

it('undoes to the heuristic category: filename, then text, then the stored size', () => {
    expect(toHeuristicCategory(row({ filename: 'Screenshot_1.png' }))).toBe('screenshot');
    expect(toHeuristicCategory(row({ filename: 'scan.jpg', hasMeaningfulText: true }))).toBe('other');
    expect(toHeuristicCategory(row({ filename: 'a.jpg', width: 1920, height: 1080 }))).toBe('screenshot');
    expect(toHeuristicCategory(row({ filename: 'a.jpg', width: 3000, height: 2000 }))).not.toBe('screenshot');
    // No stored size: nothing to take an aspect ratio from, so a bare filename is not a screenshot.
    expect(toHeuristicCategory(row({ filename: 'a.jpg' }))).not.toBe('screenshot');
});

it('undo also resets the receipt that apply wrote, but apply leaves a receipt alone', () => {
    const receipt = row({ id: 'r', filename: 'Screenshot_3.png', category: 'receipt', kind: 'receipt' });

    expect(planChanges([receipt], 'undo')).toEqual([{ id: 'r', from: 'receipt', to: 'screenshot' }]);
    expect(planChanges([receipt], 'apply')).toEqual([]);
    // A receipt the verdict does not back (an LLM choice on a document verdict) is not touched by undo.
    expect(planChanges([row({ category: 'receipt', kind: 'document' })], 'undo')).toEqual([]);
});

describeDb('applying image kinds', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;

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
    });

    async function seedImage(name: string, category: string | null, kind?: ImageKind, text?: string): Promise<string> {
        const id = await seedDocument(db, { userId, name, mime: 'image/jpeg', category, ...(text ? { ocrText: text } : {}) });

        if (!kind) return id;

        await upsertImageEmbedding(
            db,
            id,
            'hash',
            MODEL,
            Array.from({ length: IMAGE_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
        );
        await upsertKind(
            db,
            id,
            {
                kind,
                scores: { photo: 0.2, screenshot: 0.1, document: 0.5, receipt: 0.1, diagram: 0.1, other: 0.1 },
                signals: { camera: [], captureDate: false, screenResolution: false, runnerUp: 'document', margin: 0.3, requiredMargin: 0.02 },
            },
            MODEL,
        );

        return id;
    }

    async function categoryOf(id: string): Promise<string | null> {
        return (await db.selectFrom('documents').select('document_category').where('id', '=', id).executeTakeFirstOrThrow()).document_category;
    }

    async function run(mode: 'apply' | 'undo', dryRun = false): Promise<string> {
        let out = '';

        await runApply(db, { mode, dryRun }, (text) => void (out += text));

        return out;
    }

    it('rewrites categories from verdicts, prints counts, and a second run changes nothing', async () => {
        const shot = await seedImage('a.jpg', 'other', 'screenshot');
        const camera = await seedImage('b.jpg', 'screenshot', 'photo');
        const invoice = await seedImage('c.jpg', 'invoice', 'document', 'TOTAL 10');
        const waiting = await seedImage('d.jpg', 'screenshot');
        const pdf = await seedDocument(db, { userId, name: 'e.pdf', category: 'other' });

        const first = await run('apply');

        expect(first).toContain('to change: 2');
        expect(first).toContain('other -> screenshot: 1');
        expect(first).toContain('screenshot -> photo: 1');
        expect(await categoryOf(shot)).toBe('screenshot');
        expect(await categoryOf(camera)).toBe('photo');
        expect(await categoryOf(invoice)).toBe('invoice');
        expect(await categoryOf(waiting)).toBe('screenshot');
        expect(await categoryOf(pdf)).toBe('other');
        expect(await run('apply')).toContain('to change: 0');
    });

    it('writes nothing on a dry run', async () => {
        const id = await seedImage('a.jpg', 'other', 'screenshot');

        expect(await run('apply', true)).toContain('to change: 1');
        expect(await categoryOf(id)).toBe('other');
    });

    it('undoes to the heuristic category, leaving an LLM-chosen one', async () => {
        const text = await seedImage('scan.jpg', 'screenshot', 'screenshot', 'WORDS');
        const named = await seedImage('Screenshot_2.jpg', 'photo', 'photo');
        const invoice = await seedImage('c.jpg', 'invoice', 'document', 'TOTAL 10');

        const out = await run('undo');

        expect(out).toContain('mode: undo');
        expect(await categoryOf(text)).toBe('other');
        expect(await categoryOf(named)).toBe('screenshot');
        expect(await categoryOf(invoice)).toBe('invoice');
    });

    it('apply then undo restores a receipt verdict row to the heuristic category', async () => {
        const id = await seedImage('scan.jpg', 'other', 'receipt', 'TOTAL 5');

        await run('apply');
        expect(await categoryOf(id)).toBe('receipt');

        await run('undo');
        expect(await categoryOf(id)).toBe('other');
    });

    it('prints no filenames or OCR text', async () => {
        await seedImage('secret-name.jpg', 'other', 'screenshot', 'SECRET WORDS');

        const out = await run('apply');

        expect(out).not.toContain('SECRET');
        expect(out).not.toContain('secret-name');
    });
});

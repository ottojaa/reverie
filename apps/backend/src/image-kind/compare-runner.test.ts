import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { upsertImageEmbedding } from '../embeddings/embedding.repository';
import { dbProxy } from '../testing/db-proxy.js';
import { IMAGE_DIMENSIONS, IMAGE_MODEL } from '../testing/fake-ml.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { loadComparisonRows, runComparison } from './compare-runner';
import { upsertKind } from './kind.repository';

const MODEL = { model: IMAGE_MODEL.name, version: IMAGE_MODEL.revision };

describeDb('image kind comparison', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        dbProxy.use(db);
        userId = await seedUser(db, 'owner');
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });
    beforeEach(async () => {
        await db.deleteFrom('documents').execute();
    });

    async function seedImage(
        name: string,
        options: { category: string | null; kind?: 'photo' | 'document'; text?: string; takenAt?: Date; cameraMake?: string },
    ) {
        const id = await seedDocument(db, {
            userId,
            name,
            mime: 'image/jpeg',
            category: options.category,
            ...(options.text ? { ocrText: options.text } : {}),
            ...(options.takenAt || options.cameraMake ? { photo: { takenAt: options.takenAt, cameraMake: options.cameraMake } } : {}),
        });

        if (!options.kind) return id;

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
                kind: options.kind,
                scores: { photo: 0.2, screenshot: 0.1, document: 0.5, receipt: 0.1, diagram: 0.1, other: 0.1 },
                signals: { camera: [], captureDate: false, screenResolution: false, runnerUp: 'document', margin: 0.3, requiredMargin: 0.02 },
            },
            MODEL,
        );

        return id;
    }

    async function report(): Promise<string> {
        let out = '';

        await runComparison(db, (text) => void (out += text));

        return out;
    }

    it('prints the report for the seeded library, including the two privacy lists', async () => {
        await seedImage('agrees.jpg', { category: 'photo', kind: 'photo' });
        await seedImage('camera-paper.jpg', { category: 'photo', kind: 'document', cameraMake: 'Apple' });
        await seedImage('letter-scan.jpg', { category: 'letter', kind: 'document', text: 'SECRET WORDS' });
        await seedImage('not-embedded-yet.jpg', { category: 'screenshot' });
        await seedDocument(db, { userId, name: 'report.pdf', ocrText: 'not an image' });

        const out = await report();

        expect(out).toContain('images: 4  with verdict: 3');
        expect(out).toContain('PRIVACY 1: camera evidence (make, model, lens or GPS), no meaningful text, non-photo verdict: 1');
        expect(out).toContain('PRIVACY 2: currently categorised photo, non-photo verdict: 1');
        expect(out).toContain('camera-paper.jpg');
        expect(out).toContain('All disagreements (verdict vs current category): 1');
        expect(out).toContain('Images without a verdict: 1');
        expect(out).not.toContain('report.pdf');
    });

    it('does not count a lone capture date as camera evidence', async () => {
        await seedImage('Screenshot_1.jpg', { category: 'screenshot', kind: 'document', takenAt: new Date('2025-06-01') });

        const out = await report();

        expect(out).toContain('PRIVACY 1: camera evidence (make, model, lens or GPS), no meaningful text, non-photo verdict: 0');
        expect(out).toContain('Date only: 1 verdict(s)');
    });

    it('prints no image or OCR content', async () => {
        await seedImage('letter-scan.jpg', { category: 'letter', kind: 'document', text: 'SECRET WORDS' });

        expect(await report()).not.toContain('SECRET');
    });

    it('leaves out trashed images', async () => {
        const id = await seedImage('gone.jpg', { category: 'photo', kind: 'photo' });

        await db.updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', id).execute();

        expect(await loadComparisonRows(db)).toEqual([]);
    });

    it('reads in a read-only transaction: a write inside it is refused, and nothing changes', async () => {
        const id = await seedImage('agrees.jpg', { category: 'photo', kind: 'photo' });
        const before = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

        await report();

        expect(await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow()).toEqual(before);

        // The same SET TRANSACTION the runner uses really does refuse writes on this database.
        await expect(
            db.transaction().execute(async (trx) => {
                await sql`SET TRANSACTION READ ONLY`.execute(trx);
                await trx.updateTable('documents').set({ document_category: 'other' }).where('id', '=', id).execute();
            }),
        ).rejects.toThrow(/read-only/);
    });
});

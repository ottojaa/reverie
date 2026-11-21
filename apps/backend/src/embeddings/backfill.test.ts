import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { EmbedBackfillCursor } from '../queues/embed.queue';
import { dbProxy } from '../testing/db-proxy.js';
import { createFakeMl, type FakeMl } from '../testing/fake-ml.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { runBackfillPage, type BackfillDeps, type BackfillStep } from './backfill';
import { embedDocumentImage, embedDocumentText } from './embedding.service';

const START: EmbedBackfillCursor = { stage: 'text', after: null };

describeDb('embedding backfill', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let ml: FakeMl;
    let queued: { kind: string; id: string }[];
    let busy: boolean;
    let deps: BackfillDeps;

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
        // Every test starts from an empty library.
        await db.deleteFrom('documents').execute();
        ml = createFakeMl();
        queued = [];
        busy = false;
        deps = {
            db,
            ml,
            isBusy: async () => busy,
            enqueue: async (kind, id) => void queued.push({ kind, id }),
            batchSize: 2,
        };
    });

    const embedAll = async () => {
        const read = async () => Buffer.from('x');

        for (const { kind, id } of queued.splice(0)) {
            if (kind === 'embed-text') await embedDocumentText({ db, ml, readFile: read }, id);
            else await embedDocumentImage({ db, ml, readFile: read }, id);
        }
    };

    /** Runs pages until the backfill says done, embedding what each page queued. Returns the steps taken. */
    async function runToEnd(from: EmbedBackfillCursor = START, maxPages = 20): Promise<BackfillStep[]> {
        const steps: BackfillStep[] = [];
        let cursor = from;

        for (let i = 0; i < maxPages; i++) {
            const step = await runBackfillPage(deps, cursor);

            steps.push(step);

            if (step.kind !== 'next') break;

            cursor = step.cursor;
            await embedAll();
        }

        return steps;
    }

    async function seedLibrary() {
        const text = [] as string[];

        for (let i = 0; i < 5; i++) text.push(await seedDocument(db, { userId, name: `t${i}.pdf`, ocrText: 'text ' + i }));

        const photo = await seedDocument(db, { userId, name: 'p.jpg', mime: 'image/jpeg' });

        await db
            .updateTable('documents')
            .set({ thumbnail_paths: { sm: '/s', md: '/m', lg: '/l' } })
            .where('id', '=', photo)
            .execute();

        return { text, photo };
    }

    it('walks the whole library in pages, text first and then images, and finishes', async () => {
        const { text, photo } = await seedLibrary();
        const steps = await runToEnd();

        expect(steps.at(-1)).toEqual({ kind: 'done' });

        const embedded = await db.selectFrom('document_text_embeddings').select('document_id').distinct().execute();
        const images = await db.selectFrom('document_image_embeddings').select('document_id').execute();

        expect(embedded.map((row) => row.document_id).sort()).toEqual([...text].sort());
        expect(images.map((row) => row.document_id)).toEqual([photo]);
    });

    it('resumes after an interruption: a restart from the beginning only queues what is still missing', async () => {
        const { text } = await seedLibrary();
        const first = await runBackfillPage(deps, START);

        expect(first.kind).toBe('next');
        expect(queued).toHaveLength(2);
        // Only one of the two queued documents finished before the "crash".
        await embedAll();

        const done = await db.selectFrom('document_text_embeddings').select('document_id').distinct().execute();

        // Restart with a fresh cursor, as the next backend start does.
        queued = [];
        await runToEnd(START);

        const total = await db.selectFrom('document_text_embeddings').select('document_id').distinct().execute();

        expect(done).toHaveLength(2);
        expect(total).toHaveLength(text.length);
    });

    it('never queues a document that already has current embeddings, and does queue after a model change', async () => {
        await seedLibrary();
        await runToEnd();

        queued = [];
        expect((await runBackfillPage(deps, START)).kind).toBe('next');
        expect(queued).toHaveLength(0);

        ml.setTextRevision('rev-2');
        await runBackfillPage(deps, START);

        expect(queued.map((job) => job.kind)).toEqual(['embed-text', 'embed-text']);
    });

    it('leaves out trashed documents, documents without text, and non-image files for the image pass', async () => {
        const live = await seedDocument(db, { userId, name: 'live.pdf', ocrText: 'text' });

        await seedDocument(db, { userId, name: 'trashed.pdf', ocrText: 'text', deleted: true });
        await seedDocument(db, { userId, name: 'blank.pdf' });
        await seedDocument(db, { userId, name: 'noThumb.jpg', mime: 'image/jpeg' });
        await runToEnd();

        const rows = await db.selectFrom('document_text_embeddings').select('document_id').execute();

        expect(rows.map((row) => row.document_id)).toEqual([live]);
        expect(await db.selectFrom('document_image_embeddings').select('document_id').execute()).toHaveLength(0);
    });

    it('waits, and pages nothing, while OCR, summaries or embedding have work', async () => {
        await seedLibrary();
        busy = true;

        expect(await runBackfillPage(deps, START)).toEqual({ kind: 'wait', reason: 'queues-busy' });
        expect(queued).toHaveLength(0);
    });

    it('waits, and pages nothing, while reverie-ml is down or still loading', async () => {
        await seedLibrary();
        ml.setDown(true);

        expect(await runBackfillPage(deps, START)).toEqual({ kind: 'wait', reason: 'ml-not-ready' });
        expect(queued).toHaveLength(0);
    });
});

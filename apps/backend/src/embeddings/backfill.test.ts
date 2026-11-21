import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { EmbedBackfillCursor } from '../queues/embed.queue';
import { dbProxy } from '../testing/db-proxy.js';
import { createFakeMl, type FakeMl } from '../testing/fake-ml.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { loadScanConfig, scanDuplicates } from '../duplicates/scan';
import { readDocumentMedia } from '../media/media-read';
import { clearPromptCache } from '../image-kind/prompt-cache';
import { classifyDocumentImage } from '../image-kind/service';
import { PROMPT_ONLY_CLASSIFIER } from '../testing/kind-config.js';
import type { LlmMetadata } from '../llm/types';
import { UNDERSTAND_PAGE_SIZE, findImagesToUnderstand, queueUnderstanding } from '../llm/understand-backfill';
import { parseFfprobe } from '../media/video-probe';
import { runBackfillPage, type BackfillDeps, type BackfillStep } from './backfill';
import { embedDocumentImage, embedDocumentText } from './embedding.service';

const START: EmbedBackfillCursor = { stage: 'text', after: null };

/** What probing a video that carries no facts returns. */
const NO_VIDEO_FACTS = parseFfprobe({});

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
        clearPromptCache();
        ml = createFakeMl();
        queued = [];
        busy = false;
        deps = {
            db,
            ml,
            isBusy: async () => busy,
            enqueue: async (kind, id) => void queued.push({ kind, id }),
            batchSize: 2,
            classifier: PROMPT_ONLY_CLASSIFIER,
        };
    });

    const embedAll = async () => {
        const read = async () => Buffer.from('x');

        for (const { kind, id } of queued.splice(0)) {
            if (kind === 'embed-text') await embedDocumentText({ db, ml, readFile: read }, id);
            else if (kind === 'classify-image') await classifyDocumentImage({ db, ml, config: PROMPT_ONLY_CLASSIFIER }, id);
            else if (kind === 'scan-duplicates') await scanDuplicates(id);
            else if (kind === 'read-camera') await readDocumentMedia({ db, readFile: read, probeVideo: async () => NO_VIDEO_FACTS }, id);
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

        // Only the first of the two queued documents finishes before the "crash"; the second stays queued but unembedded.
        const [finished, unfinished] = queued.splice(0);
        const read = async () => Buffer.from('x');

        await embedDocumentText({ db, ml, readFile: read }, finished!.id);

        // Restart with a fresh cursor, as the next backend start does: the finished document is not queued again,
        // the unfinished one is.
        await runBackfillPage(deps, START);

        expect(queued.map((job) => job.id)).toContain(unfinished!.id);
        expect(queued.map((job) => job.id)).not.toContain(finished!.id);

        queued = [];
        await runToEnd(START);

        const total = await db.selectFrom('document_text_embeddings').select('document_id').distinct().execute();

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

    describe('the kind stage', () => {
        const kindIds = async () => (await db.selectFrom('document_image_kinds').select('document_id').execute()).map((row) => row.document_id).sort();

        async function seedImages(count: number): Promise<string[]> {
            const ids: string[] = [];

            for (let i = 0; i < count; i++) {
                const id = await seedDocument(db, { userId, name: `img${i}.jpg`, mime: 'image/jpeg' });

                await db
                    .updateTable('documents')
                    .set({ thumbnail_paths: { sm: '/s', md: '/m', lg: '/l' } })
                    .where('id', '=', id)
                    .execute();
                ids.push(id);
            }

            return ids;
        }

        it('fills a verdict for every embedded image after the embeddings, and never touches document_category', async () => {
            const ids = await seedImages(5);
            const steps = await runToEnd();

            expect(steps.at(-1)).toEqual({ kind: 'done' });
            expect(await kindIds()).toEqual([...ids].sort());
            expect(await db.selectFrom('documents').select('document_category').where('id', 'in', ids).execute()).toEqual(
                ids.map(() => ({ document_category: null })),
            );
        });

        it('asks reverie-ml for the prompt embeddings once for the whole library', async () => {
            await seedImages(5);
            await runToEnd();

            expect(ml.imageTextCalls).toHaveLength(1);
        });

        it('resumes from a cursor: images before it are left, images after it are queued, and finished ones are not queued again', async () => {
            const ids = (await seedImages(4)).sort();

            // Embeddings only: no verdicts yet.
            for (const id of ids) await embedDocumentImage({ db, ml, readFile: async () => Buffer.from('x') }, id);

            expect(await kindIds()).toEqual([]);

            const first = await runBackfillPage(deps, { stage: 'kind', after: null });

            expect(first.kind).toBe('next');
            expect(queued.map((job) => job.kind)).toEqual(['classify-image', 'classify-image']);

            // "Crash" after the first page: one job ran, the other did not. A restart from the beginning queues only the rest.
            const [finished] = queued.splice(0);

            await classifyDocumentImage({ db, ml, config: PROMPT_ONLY_CLASSIFIER }, finished!.id);
            await runBackfillPage(deps, { stage: 'kind', after: null });

            expect(queued.map((job) => job.id)).not.toContain(finished!.id);
            expect(queued).toHaveLength(2);

            queued = [];
            await runToEnd({ stage: 'kind', after: ids[1]! });

            expect((await kindIds()).filter((id) => id > ids[1]!)).toEqual(ids.filter((id) => id > ids[1]!));
        });

        it('classifies again after the classifier version or the image model changes', async () => {
            await seedImages(2);
            await runToEnd();
            queued = [];

            // Nothing left to classify: the kind stage hands over to the duplicates stage.
            expect(await runBackfillPage(deps, { stage: 'kind', after: null })).toEqual({ kind: 'next', cursor: { stage: 'duplicates', after: null } });
            expect(queued).toHaveLength(0);

            await db.updateTable('document_image_kinds').set({ prompt_version: 'older' }).execute();
            await runBackfillPage(deps, { stage: 'kind', after: null });

            expect(queued.map((job) => job.kind)).toEqual(['classify-image', 'classify-image']);
        });

        it('leaves out trashed images and images without an embedding for the current model', async () => {
            const [live, trashed] = await seedImages(2);

            await db.updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', trashed!).execute();
            await runToEnd();

            expect(await kindIds()).toEqual([live]);
        });
    });

    describe('the camera stage', () => {
        const unread = () =>
            db
                .selectFrom('documents')
                .select('id')
                .where('media_read_at', 'is', null)
                .where((eb) => eb.or([eb('mime_type', 'like', 'image/%'), eb('mime_type', 'like', 'video/%')]))
                .orderBy('id')
                .execute();

        async function seedUnreadImages(count: number): Promise<string[]> {
            const ids: string[] = [];

            for (let i = 0; i < count; i++) ids.push(await seedDocument(db, { userId, name: `cam${i}.jpg`, mime: 'image/jpeg' }));

            return ids.sort();
        }

        it('comes after the image stage and before the kind stage, and queues a read for every unread image', async () => {
            const ids = await seedUnreadImages(3);

            expect(await runBackfillPage(deps, { stage: 'image', after: null })).toEqual({ kind: 'next', cursor: { stage: 'camera', after: null } });

            const page = await runBackfillPage(deps, { stage: 'camera', after: null });

            expect(page).toEqual({ kind: 'next', cursor: { stage: 'camera', after: ids[1] } });
            expect(queued).toEqual(ids.slice(0, 2).map((id) => ({ kind: 'read-camera', id })));

            queued = [];
            await runBackfillPage(deps, { stage: 'camera', after: ids[1]! });
            expect(queued.map((job) => job.id)).toEqual([ids[2]]);

            for (const id of ids) await readDocumentMedia({ db, readFile: async () => Buffer.from('x'), probeVideo: async () => NO_VIDEO_FACTS }, id);

            expect(await unread()).toEqual([]);
            expect(await runBackfillPage(deps, { stage: 'camera', after: null })).toEqual({ kind: 'next', cursor: { stage: 'kind', after: null } });
        });

        it('queues videos too, and is idempotent: a finished library queues nothing more', async () => {
            const photo = await seedDocument(db, { userId, name: 'p.jpg', mime: 'image/jpeg' });
            const clip = await seedDocument(db, { userId, name: 'c.mp4', mime: 'video/mp4' });

            await runBackfillPage(deps, { stage: 'camera', after: null });
            expect(queued.map((job) => job.id).sort()).toEqual([photo, clip].sort());

            await embedAll();
            queued = [];
            await runBackfillPage(deps, { stage: 'camera', after: null });
            expect(queued).toEqual([]);
            expect(await unread()).toEqual([]);
        });

        it('hands over to the kind stage once every image has been read, and resumes after an interruption', async () => {
            const ids = await seedUnreadImages(4);

            await runBackfillPage(deps, { stage: 'camera', after: null });

            // Only the first queued read finishes before the "crash"; a restart queues the other three, not the finished one.
            const [finished] = queued.splice(0);

            await readDocumentMedia({ db, readFile: async () => Buffer.from('x'), probeVideo: async () => NO_VIDEO_FACTS }, finished!.id);
            queued = [];
            await runBackfillPage(deps, { stage: 'camera', after: null });
            expect(queued.map((job) => job.id)).not.toContain(finished!.id);

            queued = [];
            await runToEnd({ stage: 'camera', after: null });
            expect(await unread()).toEqual([]);
            expect(await runBackfillPage(deps, { stage: 'camera', after: null })).toEqual({ kind: 'next', cursor: { stage: 'kind', after: null } });
            expect(ids).toHaveLength(4);
        });

        it('re-classifies a verdict made by the earlier classifier version', async () => {
            const id = await seedDocument(db, { userId, name: 'v1.jpg', mime: 'image/jpeg', cameraReadAt: new Date() });

            await db
                .updateTable('documents')
                .set({ thumbnail_paths: { sm: '/s', md: '/m', lg: '/l' } })
                .where('id', '=', id)
                .execute();
            await embedDocumentImage({ db, ml, readFile: async () => Buffer.from('x') }, id);
            await classifyDocumentImage({ db, ml, config: PROMPT_ONLY_CLASSIFIER }, id);
            await db.updateTable('document_image_kinds').set({ prompt_version: 'older-version' }).where('document_id', '=', id).execute();

            await runBackfillPage(deps, { stage: 'kind', after: null });

            expect(queued).toEqual([{ kind: 'classify-image', id }]);

            queued = [];
            await classifyDocumentImage({ db, ml, config: PROMPT_ONLY_CLASSIFIER }, id);
            await runBackfillPage(deps, { stage: 'kind', after: null });

            expect(queued).toEqual([]);
        });
    });

    describe('the duplicates stage', () => {
        const scanned = (id: string, threshold: number) =>
            db.insertInto('document_duplicate_scans').values({ document_id: id, threshold, scanned_at: new Date() }).execute();

        async function embeddedImage(name: string): Promise<string> {
            const id = await seedDocument(db, { userId, name, mime: 'image/jpeg' });

            await db
                .updateTable('documents')
                .set({ thumbnail_paths: { sm: '/s', md: '/m', lg: '/l' } })
                .where('id', '=', id)
                .execute();
            await embedDocumentImage({ db, ml, readFile: async () => Buffer.from(name) }, id);

            return id;
        }

        it('queues the images that were never scanned, and hands over to the understand stage when none are left', async () => {
            const ids = [await embeddedImage('a.jpg'), await embeddedImage('b.jpg')].sort();
            const text = await seedDocument(db, { userId, name: 'note.pdf', ocrText: 'text' });

            await seedDocument(db, { userId, name: 'no-embedding.jpg', mime: 'image/jpeg' });

            const first = await runBackfillPage({ ...deps, batchSize: 10 }, { stage: 'duplicates', after: null });

            expect(queued).toEqual(ids.map((id) => ({ kind: 'scan-duplicates', id })));
            expect(first.kind).toBe('next');
            expect(queued.map((job) => job.id)).not.toContain(text);

            await embedAll();

            expect(await runBackfillPage(deps, { stage: 'duplicates', after: null })).toEqual({ kind: 'next', cursor: { stage: 'understand', after: null } });
        });

        it('scans again only the images scanned at a higher threshold than today’s', async () => {
            const lowered = await embeddedImage('c.jpg');
            const current = await embeddedImage('d.jpg');
            const { minSimilarity } = loadScanConfig();

            await scanned(lowered, Math.min(1, minSimilarity + 0.03));
            await scanned(current, minSimilarity);
            queued = [];

            await runBackfillPage({ ...deps, batchSize: 10 }, { stage: 'duplicates', after: null });

            expect(queued).toEqual([{ kind: 'scan-duplicates', id: lowered }]);
        });
    });

    describe('the understand stage (the image call over existing screenshots and document images)', () => {
        let llmJobs: { documentId: string; userId: string; jobId: string }[];

        beforeEach(() => {
            llmJobs = [];
            deps = {
                ...deps,
                batchSize: UNDERSTAND_PAGE_SIZE,
                queueUnderstanding: (id) => queueUnderstanding(db, async (data, jobId) => void llmJobs.push({ ...data, jobId }), id),
            };
        });

        async function seedClassified(name: string, kind: string, extra: { camera?: boolean; deleted?: boolean; summary?: string } = {}): Promise<string> {
            const id = await seedDocument(db, {
                userId,
                name,
                mime: 'image/png',
                category: kind === 'photo' ? 'photo' : 'screenshot',
                ...(extra.deleted && { deleted: true }),
                ...(extra.camera && { photo: { cameraMake: 'Canon' } }),
            });

            await db
                .insertInto('document_image_kinds')
                .values({ document_id: id, kind, scores: '{}', signals: '{}', prompt_version: 'v', model: 'm', model_version: '1' })
                .execute();

            if (extra.summary) {
                await db
                    .insertInto('llm_results')
                    .values({
                        document_id: id,
                        summary: extra.summary,
                        metadata: toMetadata('image_understanding'),
                        token_count: 1,
                        processing_type: 'image_understanding',
                    })
                    .execute();
            }

            return id;
        }

        // What the image call (or the vision call before it) stored in llm_results.metadata; only `type` matters here.
        const toMetadata = (type: string) => ({ type, entities: [], topics: [] }) as unknown as LlmMetadata;

        const START_UNDERSTAND: EmbedBackfillCursor = { stage: 'understand', after: null };

        it('comes after the duplicates stage, and finishes the whole backfill', async () => {
            expect(await runBackfillPage(deps, { stage: 'duplicates', after: null })).toEqual({ kind: 'next', cursor: START_UNDERSTAND });
            expect(await runBackfillPage(deps, START_UNDERSTAND)).toEqual({ kind: 'done' });
        });

        it('queues screenshots, documents, receipts and diagrams, in id order, a small page at a time', async () => {
            const ids = [
                await seedClassified('a.png', 'screenshot'),
                await seedClassified('b.png', 'document'),
                await seedClassified('c.png', 'receipt'),
                await seedClassified('d.png', 'diagram'),
                await seedClassified('e.png', 'screenshot'),
                await seedClassified('f.png', 'screenshot'),
            ].sort();

            // A page is capped at UNDERSTAND_PAGE_SIZE however big the other stages' batches are.
            deps = { ...deps, batchSize: 50 };

            const first = await runBackfillPage(deps, START_UNDERSTAND);

            expect(first).toEqual({ kind: 'next', cursor: { stage: 'understand', after: ids[UNDERSTAND_PAGE_SIZE - 1] } });
            expect(llmJobs.map((job) => job.documentId)).toEqual(ids.slice(0, UNDERSTAND_PAGE_SIZE));
            expect(llmJobs.every((job) => job.userId === userId)).toBe(true);
            expect(await db.selectFrom('processing_jobs').select('id').where('job_type', '=', 'llm_summary').execute()).toHaveLength(UNDERSTAND_PAGE_SIZE);
        });

        it('never queues a photo, an image with camera evidence, a trashed image or a private one', async () => {
            const folder = await seedFolder(db, userId, 'locked', { isPrivate: true });

            await seedClassified('photo.png', 'photo');
            await seedClassified('other.png', 'other');
            await seedClassified('camera.png', 'document', { camera: true });
            await seedClassified('trashed.png', 'screenshot', { deleted: true });

            const priv = await seedClassified('private.png', 'screenshot');

            await db.updateTable('documents').set({ folder_id: folder.id }).where('id', '=', priv).execute();
            // Non-images keep the text path: an image-kind row never exists for a PDF, and a PDF is never picked.
            await seedDocument(db, { userId, name: 'plain.pdf', ocrText: 'text', summary: 'old summary' });

            await runBackfillPage(deps, START_UNDERSTAND);

            expect(llmJobs).toEqual([]);
        });

        it('skips an image that already has an image summary, and replaces one the old vision call wrote', async () => {
            const done = await seedClassified('done.png', 'screenshot', { summary: 'new style' });
            const old = await seedClassified('old.png', 'screenshot');

            await db
                .insertInto('llm_results')
                .values({
                    document_id: old,
                    summary: 'A screenshot.',
                    metadata: toMetadata('vision_describe'),
                    token_count: 1,
                    processing_type: 'vision_describe',
                })
                .execute();

            expect(await findImagesToUnderstand(db, null, 10)).toEqual([old]);
            expect(done).not.toBe(old);
        });

        it('resumes: a restart queues only what has no job yet, and finished ones drop out', async () => {
            const ids = [
                await seedClassified('a.png', 'screenshot'),
                await seedClassified('b.png', 'screenshot'),
                await seedClassified('c.png', 'screenshot'),
            ].sort();

            await runBackfillPage(deps, START_UNDERSTAND);
            expect(llmJobs).toHaveLength(3);

            // A restart while those jobs are still pending queues nothing a second time.
            llmJobs = [];
            await runBackfillPage(deps, START_UNDERSTAND);
            expect(llmJobs).toEqual([]);

            // One finishes (summary stored, job complete); the other two are still in the queue. A fresh run adds nothing.
            await db.updateTable('processing_jobs').set({ status: 'complete' }).where('target_id', '=', ids[0]!).execute();
            await db
                .insertInto('llm_results')
                .values({
                    document_id: ids[0]!,
                    summary: 's',
                    metadata: toMetadata('image_understanding'),
                    token_count: 1,
                    processing_type: 'image_understanding',
                })
                .execute();
            await runBackfillPage(deps, START_UNDERSTAND);
            expect(llmJobs).toEqual([]);

            // The other two are interrupted (jobs lost and marked complete without a summary): they are queued again, the finished one is not.
            await db.updateTable('processing_jobs').set({ status: 'complete' }).execute();
            await runBackfillPage(deps, START_UNDERSTAND);
            expect(llmJobs.map((job) => job.documentId)).toEqual([ids[1], ids[2]]);
        });

        it('resumes from the cursor and not from the start', async () => {
            const ids = [
                await seedClassified('a.png', 'screenshot'),
                await seedClassified('b.png', 'screenshot'),
                await seedClassified('c.png', 'screenshot'),
            ].sort();

            await runBackfillPage(deps, { stage: 'understand', after: ids[1]! });

            expect(llmJobs.map((job) => job.documentId)).toEqual([ids[2]]);
        });

        it('does not retry an image whose job failed in the last day, and does after that', async () => {
            const id = await seedClassified('bad.png', 'screenshot');
            const job = await db
                .insertInto('processing_jobs')
                .values({ user_id: userId, job_type: 'llm_summary', target_type: 'document', target_id: id, status: 'failed' })
                .returning('id')
                .executeTakeFirstOrThrow();

            await runBackfillPage(deps, START_UNDERSTAND);
            expect(llmJobs).toEqual([]);

            // created_at cannot be set through the typed update, so age the failure in SQL.
            await sql`UPDATE processing_jobs SET created_at = now() - interval '48 hours' WHERE id = ${job.id}`.execute(db);
            await runBackfillPage(deps, START_UNDERSTAND);
            expect(llmJobs.map((queuedJob) => queuedJob.documentId)).toEqual([id]);
        });

        it('waits while the pipeline is busy, which is what rate-limits it', async () => {
            await seedClassified('a.png', 'screenshot');
            busy = true;

            expect(await runBackfillPage(deps, START_UNDERSTAND)).toEqual({ kind: 'wait', reason: 'queues-busy' });
            expect(llmJobs).toEqual([]);
        });

        it('leaves llm_status alone, so an existing summary stays shown while the new one is made', async () => {
            const id = await seedClassified('a.png', 'screenshot', { summary: 'earlier' });

            await db.deleteFrom('llm_results').where('document_id', '=', id).execute();
            await db
                .insertInto('llm_results')
                .values({ document_id: id, summary: 'earlier', metadata: toMetadata('vision_describe'), token_count: 1, processing_type: 'vision_describe' })
                .execute();
            await runBackfillPage(deps, START_UNDERSTAND);

            expect(llmJobs).toHaveLength(1);
            expect((await db.selectFrom('documents').select('llm_status').where('id', '=', id).executeTakeFirstOrThrow()).llm_status).toBe('complete');
        });

        it('is skipped when the image call is off (no queueUnderstanding): the backfill just finishes', async () => {
            await seedClassified('a.png', 'screenshot');

            const { queueUnderstanding: _off, ...without } = deps;

            expect(await runBackfillPage(without, START_UNDERSTAND)).toEqual({ kind: 'done' });
        });
    });
});

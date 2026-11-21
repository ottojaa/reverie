import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { Kysely } from 'kysely';
import { env } from '../config/env';
import type { Database, Document } from '../db/schema';
import { upsertImageEmbedding } from '../embeddings/embedding.repository';
import { MlUnavailableError } from '../embeddings/ml.client';
import { decideImageLook } from '../llm/image-look';
import { isHeldBackFromVision } from '../llm/photo-gate';
import { dbProxy } from '../testing/db-proxy.js';
import { createFakeMl, IMAGE_DIMENSIONS, IMAGE_MODEL, type FakeMl } from '../testing/fake-ml.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { listPrompts } from './classifier-config';
import { IMAGE_KINDS, type ImageKind } from './kinds';
import { clearPromptCache } from './prompt-cache';
import { classifyDocumentImage, decideLlmHandoff, isKindFlipActive, settleImageKind, type KindDeps } from './service';
import { loadStoredKind } from './kind.repository';
import { PROMPT_ONLY_CLASSIFIER } from '../testing/kind-config.js';

const MODEL = { model: IMAGE_MODEL.name, version: IMAGE_MODEL.revision };

/** Each kind's prompts sit on one axis, so an image's weight on that axis is its score for the kind. */
function promptVector(text: string): number[] {
    const kind = listPrompts(PROMPT_ONLY_CLASSIFIER).find((entry) => entry.text === text)!.kind;

    return axes({ [kind]: 1 });
}

function axes(weights: Partial<Record<ImageKind, number>>): number[] {
    return Array.from({ length: IMAGE_DIMENSIONS }, (_, i) => weights[IMAGE_KINDS[i]!] ?? 0);
}

const VISION = env as { LLM_VISION_ENABLED: boolean };

describeDb('image kind', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let ml: FakeMl;
    let queued: { documentId: string; userId: string; jobId: string }[];
    let deps: KindDeps;

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
        clearPromptCache();
        ml = createFakeMl();
        ml.setImageTextEmbedder(promptVector);
        queued = [];
        deps = {
            db,
            ml,
            flip: false,
            config: PROMPT_ONLY_CLASSIFIER,
            addLlmJob: async (data, jobId) => void queued.push({ documentId: data.documentId, userId: data.userId, jobId }),
        };
    });
    afterEach(() => {
        VISION.LLM_VISION_ENABLED = false;
    });

    interface SeedImage {
        name?: string;
        weights: Partial<Record<ImageKind, number>> | null;
        category?: string | null;
        text?: boolean;
        photo?: { takenAt?: Date; latitude?: number; longitude?: number; make?: string; model?: string };
        /** The image's camera columns have been read from its file (documents.camera_read_at). */
        cameraRead?: boolean;
        /** The OCR worker has stored the text flag and EXIF. */
        ocrDone?: boolean;
        width?: number;
        height?: number;
    }

    async function seedImage(options: SeedImage): Promise<string> {
        const id = await seedDocument(db, {
            userId,
            name: options.name ?? crypto.randomUUID() + '.jpg',
            mime: 'image/jpeg',
            category: options.category ?? null,
            ...(options.text ? { ocrText: 'some printed words' } : {}),
        });

        await db
            .updateTable('documents')
            .set({
                ocr_facts_at: options.ocrDone ? new Date() : null,
                camera_read_at: options.cameraRead ? new Date() : null,
                llm_status: 'pending',
                width: options.width ?? null,
                height: options.height ?? null,
            })
            .where('id', '=', id)
            .execute();

        if (options.text) await db.updateTable('ocr_results').set({ confidence_score: 90 }).where('document_id', '=', id).execute();

        if (options.photo) await addCameraFacts(id, options.photo);

        if (options.weights) await upsertImageEmbedding(db, id, 'hash', MODEL, axes(options.weights));

        return id;
    }

    async function addCameraFacts(id: string, photo: NonNullable<SeedImage['photo']>) {
        await db
            .insertInto('photo_metadata')
            .values({
                document_id: id,
                taken_at: photo.takenAt ?? null,
                latitude: photo.latitude ?? null,
                longitude: photo.longitude ?? null,
                camera_make: photo.make ?? null,
                camera_model: photo.model ?? null,
            })
            .onConflict((oc) => oc.column('document_id').doNothing())
            .execute();
    }

    const loadDocument = (id: string) => db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow() as Promise<Document>;
    const kindOf = async (id: string) => (await loadStoredKind(db, id))?.kind;
    const jobsFor = (id: string) => db.selectFrom('processing_jobs').selectAll().where('target_id', '=', id).execute();
    const FLIP_ON = () => (deps = { ...deps, flip: true });

    describe('classifying', () => {
        it.each(IMAGE_KINDS)('recognises a %s from its stored embedding', async (kind) => {
            const id = await seedImage({ weights: { [kind]: 0.4, photo: kind === 'photo' ? 0.4 : 0.1 } });

            await classifyDocumentImage(deps, id);

            const stored = await loadStoredKind(db, id);

            expect(stored?.kind).toBe(kind);
            expect(stored?.promptVersion).toBe(PROMPT_ONLY_CLASSIFIER.version);
            expect(stored?.model).toEqual(MODEL);
            expect(Object.keys(stored!.scores).sort()).toEqual([...IMAGE_KINDS].sort());
        });

        it('says nothing for an image without an embedding', async () => {
            const id = await seedImage({ weights: null });

            expect(await classifyDocumentImage(deps, id)).toEqual({ outcome: 'no-embedding' });
            expect(await loadStoredKind(db, id)).toBeNull();
        });

        it('gives a camera image that clearly reads as paper the document verdict', async () => {
            const id = await seedImage({
                weights: { photo: 0.3, document: 0.5 },
                photo: { takenAt: new Date('2025-06-01'), make: 'Apple', model: 'iPhone 15' },
            });

            await classifyDocumentImage(deps, id);

            expect(await kindOf(id)).toBe('document');
        });

        it('leaves a document verdict on an updated embedding when the classifier is run again', async () => {
            const id = await seedImage({ weights: { photo: 0.3, screenshot: 0.4 } });

            await classifyDocumentImage(deps, id);
            await upsertImageEmbedding(db, id, 'hash-2', MODEL, axes({ photo: 0.5, screenshot: 0.1 }));
            await classifyDocumentImage(deps, id);

            expect(await kindOf(id)).toBe('photo');
            expect(await db.selectFrom('document_image_kinds').select('document_id').where('document_id', '=', id).execute()).toHaveLength(1);
        });
    });

    describe('the prompt cache', () => {
        it('asks reverie-ml for the prompts once and never again per classification', async () => {
            const ids = await Promise.all(IMAGE_KINDS.map((kind) => seedImage({ weights: { [kind]: 0.4 } })));

            for (const id of ids) await classifyDocumentImage(deps, id);

            expect(ml.imageTextCalls).toHaveLength(1);
            expect(ml.imageTextCalls[0]).toEqual(listPrompts(PROMPT_ONLY_CLASSIFIER).map((entry) => entry.text));
            expect(ml.imageCalls).toBe(0);
            expect(ml.textCalls).toHaveLength(0);
        });

        it('keeps classifying from the cache while reverie-ml is down', async () => {
            const [first, second] = await Promise.all([seedImage({ weights: { receipt: 0.4 } }), seedImage({ weights: { diagram: 0.4 } })]);

            await classifyDocumentImage(deps, first!);
            ml.setDown(true);
            await classifyDocumentImage(deps, second!);

            expect(await kindOf(second!)).toBe('diagram');
        });

        it('does not remember a failed attempt', async () => {
            const id = await seedImage({ weights: { receipt: 0.4 } });

            ml.setDown(true);
            await expect(classifyDocumentImage(deps, id)).rejects.toBeInstanceOf(MlUnavailableError);
            expect(await loadStoredKind(db, id)).toBeNull();

            ml.setDown(false);
            await classifyDocumentImage(deps, id);

            expect(await kindOf(id)).toBe('receipt');
        });

        it('refuses to score an embedding from another image model than the prompts', async () => {
            const id = await seedImage({ weights: { receipt: 0.4 } });

            ml.setImageRevision('rev-2');

            await expect(classifyDocumentImage(deps, id)).rejects.toBeInstanceOf(MlUnavailableError);
            expect(await loadStoredKind(db, id)).toBeNull();
        });
    });

    describe('shadow mode (flip off: no ML service, or the constant set back to false)', () => {
        it('is active only with an ML service configured', () => {
            expect(isKindFlipActive(true)).toBe(true);
            expect(isKindFlipActive(false)).toBe(false);
        });

        it('stores verdicts and changes no category, status or queue', async () => {
            VISION.LLM_VISION_ENABLED = true;

            const categories = [null, 'photo', 'screenshot', 'invoice'];
            const ids = await Promise.all(
                categories.map((category, i) => seedImage({ weights: { [IMAGE_KINDS[i + 1]!]: 0.5 }, category, ocrDone: true, text: i % 2 === 0 })),
            );

            for (const id of ids) await settleImageKind(deps, id);

            for (const [i, id] of ids.entries()) {
                const doc = await loadDocument(id);

                expect(doc.document_category).toBe(categories[i]);
                expect(doc.llm_status).toBe('pending');
                expect(await kindOf(id)).toBe(IMAGE_KINDS[i + 1]);
                expect(await jobsFor(id)).toHaveLength(0);
            }

            expect(queued).toHaveLength(0);
        });
    });

    describe('the flip (on)', () => {
        beforeEach(FLIP_ON);

        it('sets the category from the verdict and queues the LLM job from the embed side, once', async () => {
            const id = await seedImage({ weights: { screenshot: 0.5, photo: 0.1 }, text: true, ocrDone: true, category: 'other' });

            const [a, b] = await Promise.all([settleImageKind(deps, id), settleImageKind(deps, id)]);

            expect([a.outcome, b.outcome]).toEqual(['classified', 'classified']);
            expect((await loadDocument(id)).document_category).toBe('screenshot');
            expect((await loadDocument(id)).llm_status).toBe('pending');
            expect(queued).toHaveLength(1);
            expect(queued[0]).toMatchObject({ documentId: id, userId });

            const jobs = await jobsFor(id);

            expect(jobs).toHaveLength(1);
            expect(jobs[0]).toMatchObject({ job_type: 'llm_summary', status: 'pending', id: queued[0]!.jobId });

            // A replay after the job exists queues nothing more.
            await settleImageKind(deps, id);

            expect(queued).toHaveLength(1);
        });

        it('queues a text-less non-photo image when vision is on, and skips it when vision is off', async () => {
            const withVision = await seedImage({ weights: { diagram: 0.5, photo: 0.1 }, ocrDone: true });
            const withoutVision = await seedImage({ weights: { diagram: 0.5, photo: 0.1 }, ocrDone: true });

            VISION.LLM_VISION_ENABLED = true;
            await settleImageKind(deps, withVision);
            VISION.LLM_VISION_ENABLED = false;
            await settleImageKind(deps, withoutVision);

            expect((await loadDocument(withVision)).document_category).toBe('graphic');
            expect(queued.map((job) => job.documentId)).toEqual([withVision]);
            expect((await loadDocument(withoutVision)).llm_status).toBe('skipped');
        });

        it('queues a screenshot or document whose OCR text is poor, because the image call reads the pixels', async () => {
            VISION.LLM_VISION_ENABLED = true;

            const poor = await seedImage({ weights: { screenshot: 0.5, photo: 0.1 }, text: true, ocrDone: true });
            const empty = await seedImage({ weights: { document: 0.5, photo: 0.1 }, ocrDone: true });
            const withoutVision = await seedImage({ weights: { screenshot: 0.5, photo: 0.1 }, text: true, ocrDone: true });

            await db.updateTable('ocr_results').set({ confidence_score: 5 }).execute();
            await settleImageKind(deps, poor);
            await settleImageKind(deps, empty);
            VISION.LLM_VISION_ENABLED = false;
            await settleImageKind(deps, withoutVision);

            expect(queued.map((job) => job.documentId).sort()).toEqual([poor, empty].sort());
            // With vision off the text rule decides: poor OCR text is not summarised.
            expect((await loadDocument(withoutVision)).llm_status).toBe('skipped');
        });

        it('queues nothing for a photo with readable text and poor OCR, whatever the vision setting', async () => {
            VISION.LLM_VISION_ENABLED = true;

            const photo = await seedImage({ weights: { photo: 0.5 }, text: true, ocrDone: true });

            await db.updateTable('ocr_results').set({ confidence_score: 5 }).where('document_id', '=', photo).execute();
            await settleImageKind(deps, photo);

            expect(queued).toHaveLength(0);
        });

        it('queues nothing for a text-less photo, and nothing for a text-less image with camera facts', async () => {
            VISION.LLM_VISION_ENABLED = true;

            const photo = await seedImage({ weights: { photo: 0.5 }, ocrDone: true });
            const camera = await seedImage({ weights: { document: 0.5, photo: 0.1 }, ocrDone: true, photo: { takenAt: new Date('2025-06-01') } });

            await settleImageKind(deps, photo);
            await settleImageKind(deps, camera);

            expect(queued).toHaveLength(0);
            expect((await loadDocument(photo)).llm_status).toBe('skipped');
            expect((await loadDocument(camera)).llm_status).toBe('skipped');
            expect((await loadDocument(photo)).document_category).toBe('photo');
        });

        it('queues a text-less date-only image once its camera columns were read and the verdict says screenshot', async () => {
            VISION.LLM_VISION_ENABLED = true;

            const read = await seedImage({
                weights: { screenshot: 0.5, photo: 0.1 },
                ocrDone: true,
                cameraRead: true,
                photo: { takenAt: new Date('2026-01-02') },
            });
            const unread = await seedImage({ weights: { screenshot: 0.5, photo: 0.1 }, ocrDone: true, photo: { takenAt: new Date('2026-01-02') } });

            await settleImageKind(deps, read);
            await settleImageKind(deps, unread);

            expect(queued.map((job) => job.documentId)).toEqual([read]);
            expect((await loadDocument(unread)).llm_status).toBe('skipped');
        });

        it('waits for OCR to finish storing its facts: no job and no skip before the marker', async () => {
            const id = await seedImage({ weights: { screenshot: 0.5 }, text: true, ocrDone: false });

            const outcome = await settleImageKind(deps, id);

            expect(outcome).toMatchObject({ outcome: 'classified', llm: 'not-ready' });
            expect(queued).toHaveLength(0);
            expect((await loadDocument(id)).llm_status).toBe('pending');
            expect((await loadDocument(id)).document_category).toBe('screenshot');

            await db.updateTable('documents').set({ ocr_facts_at: new Date() }).where('id', '=', id).execute();
            await settleImageKind(deps, id);

            expect(queued).toHaveLength(1);
        });

        it('queues a new LLM job after a reprocess (a newer OCR run) and not before', async () => {
            const id = await seedImage({ weights: { screenshot: 0.5 }, text: true, ocrDone: true });

            await settleImageKind(deps, id);
            await db.updateTable('processing_jobs').set({ status: 'complete' }).where('target_id', '=', id).execute();

            // Nothing new happened: a replay queues nothing, even though the first job is done.
            await db
                .updateTable('documents')
                .set({ ocr_facts_at: new Date(Date.now() - 60_000) })
                .where('id', '=', id)
                .execute();
            await settleImageKind(deps, id);
            expect(queued).toHaveLength(1);

            // A new OCR run stamped a newer marker: the image is summarised again.
            await db
                .updateTable('documents')
                .set({ ocr_facts_at: new Date(Date.now() + 1000) })
                .where('id', '=', id)
                .execute();
            await settleImageKind(deps, id);

            expect(queued).toHaveLength(2);
        });

        it('never queues for the existing library, whose images have no marker', async () => {
            const id = await seedImage({ weights: { screenshot: 0.5 }, text: true });

            await settleImageKind(deps, id);

            expect(queued).toHaveLength(0);
            expect(await jobsFor(id)).toHaveLength(0);
        });

        it('keeps a category the LLM chose', async () => {
            const id = await seedImage({ weights: { screenshot: 0.5 }, text: true, ocrDone: true, category: 'invoice' });

            await settleImageKind(deps, id);

            expect((await loadDocument(id)).document_category).toBe('invoice');
        });

        it('does nothing for an image without an embedding: no category, no job', async () => {
            const id = await seedImage({ weights: null, text: true, ocrDone: true, category: 'screenshot' });

            expect(await settleImageKind(deps, id)).toEqual({ outcome: 'no-embedding' });
            expect(queued).toHaveLength(0);
            expect((await loadDocument(id)).document_category).toBe('screenshot');
        });

        it('re-classifies when EXIF arrives after an early verdict: the camera facts turn a screenshot into a photo, and vision never sees it', async () => {
            VISION.LLM_VISION_ENABLED = true;

            // The embed job beat OCR: no camera facts yet, so the first verdict reads as a screenshot.
            const id = await seedImage({ weights: { photo: 0.3, screenshot: 0.34 }, ocrDone: false });

            await settleImageKind(deps, id);

            expect(await kindOf(id)).toBe('screenshot');
            expect((await loadDocument(id)).document_category).toBe('screenshot');
            expect(queued).toHaveLength(0);

            // OCR stores the camera facts and the marker, then asks for a new classification.
            await addCameraFacts(id, { takenAt: new Date('2025-06-01'), make: 'Apple', model: 'iPhone 15' });
            await db.updateTable('documents').set({ ocr_facts_at: new Date() }).where('id', '=', id).execute();
            await settleImageKind(deps, id);

            expect(await kindOf(id)).toBe('photo');
            expect((await loadDocument(id)).document_category).toBe('photo');
            expect(queued).toHaveLength(0);
            expect((await loadDocument(id)).llm_status).toBe('skipped');
        });
    });

    describe('the privacy gate', () => {
        const gate = (flip: boolean, serving = true) => {
            ml.setDown(!serving);

            return { flip, ml };
        };

        it('holds back an image with a camera make or model even when it has no capture date, whatever its category', async () => {
            const makeOnly = await seedImage({ weights: null, photo: { make: 'Apple', model: 'iPhone 15' }, category: 'screenshot', cameraRead: true });
            const lensOnly = await seedImage({ weights: null, category: 'screenshot', cameraRead: true });

            await db.insertInto('photo_metadata').values({ document_id: lensOnly, lens_model: 'iPhone 15 back camera' }).execute();

            expect(await isHeldBackFromVision(await loadDocument(makeOnly), gate(false))).toBe(true);
            expect(await isHeldBackFromVision(await loadDocument(lensOnly), gate(true))).toBe(true);
        });

        it('lets a verdict, not the capture date, decide a date-only image once its camera columns have been read (flip on)', async () => {
            const screenshot = await seedImage({
                weights: { screenshot: 0.5, photo: 0.1 },
                photo: { takenAt: new Date('2026-01-02') },
                category: 'screenshot',
                cameraRead: true,
            });
            const photo = await seedImage({ weights: { photo: 0.5 }, photo: { takenAt: new Date('2026-01-02') }, category: 'screenshot', cameraRead: true });

            deps = { ...deps, flip: true };
            await settleImageKind(deps, screenshot);
            await settleImageKind(deps, photo);

            expect(await isHeldBackFromVision(await loadDocument(screenshot), gate(true))).toBe(false);
            expect(await isHeldBackFromVision(await loadDocument(photo), gate(true))).toBe(true);
        });

        it('holds back a date-only image whose camera columns have not been read yet, flip on or off', async () => {
            const id = await seedImage({ weights: { screenshot: 0.5, photo: 0.1 }, photo: { takenAt: new Date('2026-01-02') }, category: 'screenshot' });

            await classifyDocumentImage(deps, id);

            expect(await isHeldBackFromVision(await loadDocument(id), gate(true))).toBe(true);
            expect(await isHeldBackFromVision(await loadDocument(id), gate(false))).toBe(true);
        });

        it('holds back a date-only image the heuristics called a screenshot when reverie-ml is down, so there is no verdict to trust', async () => {
            const id = await seedImage({ weights: null, photo: { takenAt: new Date('2026-01-02') }, category: 'screenshot', cameraRead: true });

            expect(await isHeldBackFromVision(await loadDocument(id), gate(true, false))).toBe(true);
            expect(await decideImageLook(await loadDocument(id), gate(true, false))).toEqual({ call: false, heldBack: true });
        });

        it('decides the image call from the gate, the verdict and the category, failing closed', async () => {
            const screenshot = await seedImage({ weights: { screenshot: 0.5, photo: 0.1 }, category: 'screenshot', cameraRead: true });
            const photo = await seedImage({ weights: { photo: 0.5 }, category: 'screenshot', cameraRead: true });
            const camera = await seedImage({ weights: { document: 0.5, photo: 0.1 }, category: 'other', cameraRead: true, photo: { make: 'Canon' } });
            const unknown = await seedImage({ weights: null, category: 'other', cameraRead: true });
            const noVerdictPaper = await seedImage({ weights: null, category: 'invoice', cameraRead: true });
            const noVerdictScreenshot = await seedImage({ weights: null, category: 'screenshot', cameraRead: true });

            deps = { ...deps, flip: true };

            for (const id of [screenshot, photo, camera]) await settleImageKind(deps, id);

            const look = async (id: string, serving = true) => decideImageLook(await loadDocument(id), gate(true, serving));

            expect(await look(screenshot)).toEqual({ call: true, kind: 'screenshot' });
            expect(await look(photo)).toEqual({ call: false, heldBack: true });
            expect(await look(camera)).toEqual({ call: false, heldBack: true });
            // No verdict means no call, whether reverie-ml has not judged it yet or is down: the category the OCR
            // heuristics gave (screenshot, invoice, ...) is never enough, they call a phone photo a screenshot.
            expect(await look(unknown)).toEqual({ call: false, heldBack: true });
            expect(await look(unknown, false)).toEqual({ call: false, heldBack: true });
            expect(await look(noVerdictPaper)).toEqual({ call: false, heldBack: true });
            expect(await look(noVerdictPaper, false)).toEqual({ call: false, heldBack: true });
            expect(await look(noVerdictScreenshot, false)).toEqual({ call: false, heldBack: true });
        });

        it('keeps holding back a date-only, text-free phone-sized image the heuristics called a screenshot while the flip is off', async () => {
            const id = await seedImage({
                weights: null,
                photo: { takenAt: new Date('2026-01-02') },
                category: 'screenshot',
                cameraRead: true,
                width: 4032,
                height: 3024,
            });

            expect(await isHeldBackFromVision(await loadDocument(id), gate(false))).toBe(true);
        });

        it('holds back a camera image whatever its kind, with the flip off and on', async () => {
            const withDate = await seedImage({ weights: { document: 0.5, photo: 0.1 }, photo: { takenAt: new Date('2025-06-01') }, category: 'other' });
            const withGps = await seedImage({ weights: { receipt: 0.5, photo: 0.1 }, photo: { latitude: 60.1, longitude: 24.9 }, category: 'other' });

            for (const id of [withDate, withGps]) {
                await classifyDocumentImage(deps, id);

                const doc = await loadDocument(id);

                expect(await isHeldBackFromVision(doc, gate(false))).toBe(true);
                expect(await isHeldBackFromVision(doc, gate(true))).toBe(true);
            }

            // On: the verdict sets the category to document ('other'), and the EXIF still holds the image back.
            deps = { ...deps, flip: true };
            await settleImageKind(deps, withDate);

            expect(await kindOf(withDate)).toBe('document');
            expect(await isHeldBackFromVision(await loadDocument(withDate), gate(true))).toBe(true);
        });

        it('holds back an image without a verdict while reverie-ml is serving, whatever category the heuristics gave', async () => {
            const noVerdict = await seedImage({ weights: null, category: 'screenshot' });
            const withVerdict = await seedImage({ weights: { screenshot: 0.5, photo: 0.1 }, category: 'screenshot' });

            await classifyDocumentImage(deps, withVerdict);

            expect(await isHeldBackFromVision(await loadDocument(noVerdict), gate(true))).toBe(true);
            expect(await isHeldBackFromVision(await loadDocument(withVerdict), gate(true))).toBe(false);
        });

        it("with the flip off, an image without a verdict is judged by today's rules", async () => {
            const screenshot = await seedImage({ weights: null, category: 'screenshot' });
            const uncategorised = await seedImage({ weights: null, category: null });
            const photo = await seedImage({ weights: null, category: 'photo' });

            expect(await isHeldBackFromVision(await loadDocument(screenshot), gate(false))).toBe(false);
            expect(await isHeldBackFromVision(await loadDocument(uncategorised), gate(false))).toBe(true);
            expect(await isHeldBackFromVision(await loadDocument(photo), gate(false))).toBe(true);
        });

        it("falls back to today's rules when reverie-ml is not serving", async () => {
            const screenshot = await seedImage({ weights: null, category: 'screenshot' });
            const camera = await seedImage({ weights: null, category: 'screenshot', photo: { takenAt: new Date('2025-06-01') } });

            expect(await isHeldBackFromVision(await loadDocument(screenshot), gate(true, false))).toBe(false);
            expect(await isHeldBackFromVision(await loadDocument(camera), gate(true, false))).toBe(true);
        });

        it('holds back an image the verdict calls a photo', async () => {
            deps = { ...deps, flip: true };

            const id = await seedImage({ weights: { photo: 0.5 }, category: 'screenshot' });

            await settleImageKind(deps, id);

            expect(await isHeldBackFromVision(await loadDocument(id), gate(true))).toBe(true);
        });
    });

    describe('with reverie-ml unavailable', () => {
        it('classifies nothing and changes nothing', async () => {
            deps = { ...deps, flip: true };
            ml.setDown(true);

            const id = await seedImage({ weights: { screenshot: 0.5 }, text: true, ocrDone: true, category: 'other' });

            await expect(settleImageKind(deps, id)).rejects.toBeInstanceOf(MlUnavailableError);

            expect(await loadStoredKind(db, id)).toBeNull();
            expect((await loadDocument(id)).document_category).toBe('other');
            expect(queued).toHaveLength(0);
        });

        it('leaves the OCR worker to queue the LLM job as it does today', async () => {
            const serving = createFakeMl();
            const down = createFakeMl();

            down.setDown(true);

            expect(await decideLlmHandoff(false, serving)).toBe('ocr');
            expect(await decideLlmHandoff(true, null)).toBe('ocr');
            expect(await decideLlmHandoff(true, down)).toBe('ocr');
            expect(await decideLlmHandoff(true, serving)).toBe('embed');
        });
    });
});

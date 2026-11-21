import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    parse: vi.fn(),
    file: Buffer.alloc(0),
    enqueueTextEmbedding: vi.fn(),
}));

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('./anthropic.client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./anthropic.client')>()),
    getAnthropicClient: () => ({ messages: { parse: h.parse } }),
    isLlmAvailable: () => true,
}));
vi.mock('../services/storage.service', () => ({
    assertFitsInMemory: () => undefined,
    getStorageService: () => ({ getFile: async () => h.file }),
}));
vi.mock('../embeddings/enqueue', () => ({ enqueueTextEmbedding: h.enqueueTextEmbedding }));

import type { Kysely } from 'kysely';
import type { Database, Document, OcrResult } from '../db/schema';
import { NonRetryableJobError } from '../jobs/job.types';
import { dbProxy } from '../testing/db-proxy.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { IMAGE_LONG_EDGE_PX, prepareImageForClaude } from './image-call';
import { processImageUnderstanding, toCategoryAfterLook } from './image-understanding';
import { LlmImageUnderstandingSchema } from './llm-response.schema';
import { markLlmFailed } from './llm-store';

interface Fixture {
    input: { file: string; filename: string; ocr: { raw_text: string; confidence_score: number } };
    response: { content: { text: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } };
}

const FIXTURES = join(__dirname, 'fixtures');
const fixture = JSON.parse(readFileSync(join(FIXTURES, 'image-call.fixture.json'), 'utf8')) as Fixture;
const SCREENSHOT = readFileSync(join(FIXTURES, fixture.input.file));

/** The fixture's model answer, as the SDK hands it back after parsing. */
function answer(overrides: Record<string, unknown> = {}) {
    const parsed = LlmImageUnderstandingSchema.parse({ ...JSON.parse(fixture.response.content[0]!.text), ...overrides });

    return { parsed_output: parsed, stop_reason: fixture.response.stop_reason, usage: fixture.response.usage };
}

describeDb('image call', () => {
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
        h.parse.mockReset();
        h.parse.mockResolvedValue(answer());
        h.enqueueTextEmbedding.mockReset();
        h.file = SCREENSHOT;
    });

    async function seedImage(ocr: { text: string; confidence: number } | null) {
        const id = await seedDocument(db, { userId, name: fixture.input.filename, mime: 'image/png', category: 'screenshot' });

        if (ocr) {
            await db
                .insertInto('ocr_results')
                .values({
                    document_id: id,
                    raw_text: ocr.text,
                    confidence_score: ocr.confidence,
                    text_density: null,
                    metadata: null,
                    text_vector: null,
                    duration_ms: null,
                })
                .execute();
        }

        const document = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        const ocrResult = await db.selectFrom('ocr_results').selectAll().where('document_id', '=', id).executeTakeFirst();

        return { id, document: document as Document, ocrResult: ocrResult as OcrResult | undefined };
    }

    const ocrOf = (text: string, confidence = 91) => ({ text, confidence });
    const fixtureOcr = () => ocrOf(fixture.input.ocr.raw_text, fixture.input.ocr.confidence_score);

    it('sends the image, then the text with the OCR, and stores the parsed answer', async () => {
        const { id, document, ocrResult } = await seedImage(fixtureOcr());
        const result = await processImageUnderstanding(document, ocrResult, 'screenshot');
        const request = h.parse.mock.calls[0]![0];

        expect(request.messages[0].content.map((block: { type: string }) => block.type)).toEqual(['image', 'text']);
        expect(request.messages[0].content[0].source.media_type).toBe('image/jpeg');
        expect(request.messages[0].content[1].text).toContain('PASS src/cart.test.ts');
        expect(request.output_config.format).toBeDefined();
        expect(result).toMatchObject({ success: true, tokenCount: 2308 });

        const row = await db.selectFrom('llm_results').selectAll().where('document_id', '=', id).executeTakeFirstOrThrow();

        expect(row.processing_type).toBe('image_understanding');
        expect(row.summary).toContain('terminal window');
        expect(row.token_count).toBe(2308);
        expect(row.metadata).toMatchObject({
            type: 'image_understanding',
            title: 'Test run and git status in demo-project',
            language: 'en',
            imageKind: 'screenshot',
        });
    });

    it('sends no EXIF or video fact to Claude: the request holds the re-encoded pixels, the OCR text and the instructions only', async () => {
        const { id, document, ocrResult } = await seedImage(fixtureOcr());

        await db
            .insertInto('photo_metadata')
            .values({
                document_id: id,
                iso: 31337,
                f_number: 7.77,
                focal_length: 424242,
                flash_fired: true,
                orientation: 8,
                taken_at_offset: '+05:45',
                pixel_width: 6789,
                pixel_height: 4321,
            })
            .execute();
        await db.insertInto('video_metadata').values({ document_id: id, video_codec: 'sentinel-codec', bitrate: 987654321 }).execute();
        await processImageUnderstanding(document, ocrResult, 'screenshot');

        const request = h.parse.mock.calls[0]![0];
        // The picture is base64; every other part of the request is text, and that is what is searched.
        const text = JSON.stringify(request, (key, value: unknown) => (key === 'data' ? '' : value));

        for (const sentinel of ['31337', '7.77', '424242', '6789', '4321', '+05:45', 'sentinel-codec', '987654321']) expect(text).not.toContain(sentinel);

        // The image is re-encoded by sharp, which drops every EXIF tag.
        const sent = request.messages[0].content[0].source.data as string;

        expect((await sharp(Buffer.from(sent, 'base64')).metadata()).exif).toBeUndefined();
    });

    it('stores the app or source as metadata, as an entity and as the first tag', async () => {
        const { id, document, ocrResult } = await seedImage(fixtureOcr());

        await processImageUnderstanding(document, ocrResult, 'screenshot');

        const row = await db.selectFrom('llm_results').select('metadata').where('document_id', '=', id).executeTakeFirstOrThrow();
        const metadata = row.metadata as { appOrSource: string; entities: { type: string; canonical_name: string }[] };
        const tags = await db.selectFrom('document_tags').select('tag').where('document_id', '=', id).where('source', '=', 'auto').execute();

        expect(metadata.appOrSource).toBe('Demo Terminal');
        expect(metadata.entities).toContainEqual(expect.objectContaining({ type: 'product', canonical_name: 'Demo Terminal' }));
        expect(tags.map((t) => t.tag)).toContain('Demo Terminal');
    });

    it('drops an app or source the tag rules reject from the metadata, the entity and the tags alike', async () => {
        h.parse.mockResolvedValue(answer({ app_or_source: 'A very long window title that is not an app name at all' }));

        const { id, document, ocrResult } = await seedImage(fixtureOcr());

        await processImageUnderstanding(document, ocrResult, 'screenshot');

        const row = await db.selectFrom('llm_results').select('metadata').where('document_id', '=', id).executeTakeFirstOrThrow();
        const metadata = row.metadata as { appOrSource?: string; entities: { canonical_name: string }[] };
        const tags = await db.selectFrom('document_tags').select('tag').where('document_id', '=', id).where('source', '=', 'auto').execute();

        expect(metadata.appOrSource).toBeUndefined();
        expect(metadata.entities.map((entity) => entity.canonical_name)).not.toContain('A very long window title that is not an app name at all');
        expect(tags.map((t) => t.tag)).not.toContain('A very long window title that is not an app name at all');
    });

    it('updates the document: category, status, date, a fresh search text and a new text embedding', async () => {
        const { id, document, ocrResult } = await seedImage(fixtureOcr());

        await processImageUnderstanding(document, ocrResult, 'screenshot');

        const after = await db
            .selectFrom('documents')
            .select(['document_category', 'llm_status', 'search_vector'])
            .where('id', '=', id)
            .executeTakeFirstOrThrow();

        expect(after).toMatchObject({ document_category: 'screenshot', llm_status: 'complete' });
        expect(after.search_vector).not.toBeNull();
        expect(h.enqueueTextEmbedding).toHaveBeenCalledWith(id);
    });

    it('still makes the call for a screenshot with no OCR text, and says so in the prompt', async () => {
        const { id, document } = await seedImage(null);

        await processImageUnderstanding(document, undefined, 'screenshot');

        expect(h.parse).toHaveBeenCalledTimes(1);
        expect(h.parse.mock.calls[0]![0].messages[0].content[1].text).toContain('none was found');
        expect((await db.selectFrom('llm_results').select('summary').where('document_id', '=', id).executeTakeFirstOrThrow()).summary).toContain('terminal');
    });

    it('checks entities against the OCR text when it is reliable, and not when it is poor', async () => {
        const invented = { entities: [{ type: 'organization', canonical_name: 'Invented Corporation', raw_text: 'Invented Corp' }] };

        h.parse.mockResolvedValue(answer(invented));

        const reliable = await seedImage(fixtureOcr());

        await processImageUnderstanding(reliable.document, reliable.ocrResult, 'screenshot');

        const poor = await seedImage(ocrOf('x7 q', 5));

        await processImageUnderstanding(poor.document, poor.ocrResult, 'screenshot');

        const names = async (id: string) => {
            const row = await db.selectFrom('llm_results').select('metadata').where('document_id', '=', id).executeTakeFirstOrThrow();

            return (row.metadata as { entities: { canonical_name: string }[] }).entities.map((e) => e.canonical_name);
        };

        // A name the OCR text does not support falls back to what the picture showed, but only when the OCR is worth checking against.
        expect(await names(reliable.id)).toContain('Invented Corp');
        expect(await names(poor.id)).toContain('Invented Corporation');
    });

    it('lets the kind move among screenshot, document, receipt and diagram, and never to or from photo', async () => {
        expect(LlmImageUnderstandingSchema.safeParse({ ...JSON.parse(fixture.response.content[0]!.text), kind: 'photo' }).success).toBe(false);
        expect(toCategoryAfterLook('screenshot', null)).toBe('screenshot');
        expect(toCategoryAfterLook('diagram', 'invoice')).toBe('graphic');
        expect(toCategoryAfterLook('document', 'invoice')).toBe('invoice');
        expect(toCategoryAfterLook('document', null)).toBe('other');
        expect(toCategoryAfterLook('receipt', 'other')).toBe('receipt');

        for (const kind of ['screenshot', 'document', 'receipt', 'diagram'] as const) {
            expect(toCategoryAfterLook(kind, null)).not.toBe('photo');
        }

        // A screenshot the model reads as a document moves to the document category.
        h.parse.mockResolvedValue(answer({ kind: 'document', document_type: 'invoice', app_or_source: null }));

        const { id, document, ocrResult } = await seedImage(fixtureOcr());

        await processImageUnderstanding(document, ocrResult, 'screenshot');

        expect((await db.selectFrom('documents').select('document_category').where('id', '=', id).executeTakeFirstOrThrow()).document_category).toBe('invoice');
    });

    it.each([
        ['a refusal', { stop_reason: 'refusal' }],
        ['a cut-off answer', { stop_reason: 'max_tokens' }],
        ['an answer that did not parse', { parsed_output: null }],
    ])('ends the job without a retry on %s, and writes nothing', async (_name, patch) => {
        h.parse.mockResolvedValue({ ...answer(), ...patch });

        const { id, document, ocrResult } = await seedImage(fixtureOcr());

        await expect(processImageUnderstanding(document, ocrResult, 'screenshot')).rejects.toBeInstanceOf(NonRetryableJobError);
        expect(await db.selectFrom('llm_results').select('document_id').where('document_id', '=', id).execute()).toEqual([]);
    });

    it('sends a large image downscaled to the cap, upright, as JPEG with no EXIF', async () => {
        const big = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: '#336699' } })
            .jpeg()
            .withExif({ IFD0: { Make: 'Canon', Model: 'EOS' } })
            .toBuffer();

        expect((await sharp(big).metadata()).exif).toBeDefined();

        const sent = await prepareImageForClaude(big);
        const meta = await sharp(Buffer.from(sent.base64, 'base64')).metadata();

        expect(Math.max(sent.width, sent.height)).toBe(IMAGE_LONG_EDGE_PX);
        expect(meta).toMatchObject({ format: 'jpeg', width: IMAGE_LONG_EDGE_PX, height: 980 });
        expect(meta.exif).toBeUndefined();
    });

    it('does not enlarge a small image', async () => {
        expect(await prepareImageForClaude(SCREENSHOT)).toMatchObject({ width: 1280, height: 720 });
    });

    describe('when a run fails', () => {
        it('marks a document with no summary failed', async () => {
            const { id } = await seedImage(null);

            await markLlmFailed(id);

            expect((await db.selectFrom('documents').select('llm_status').where('id', '=', id).executeTakeFirstOrThrow()).llm_status).toBe('failed');
        });

        it('leaves a document that has a summary complete', async () => {
            const { id, document, ocrResult } = await seedImage(fixtureOcr());

            await processImageUnderstanding(document, ocrResult, 'screenshot');
            await db.updateTable('documents').set({ llm_status: 'processing' }).where('id', '=', id).execute();
            await markLlmFailed(id);

            expect((await db.selectFrom('documents').select('llm_status').where('id', '=', id).executeTakeFirstOrThrow()).llm_status).toBe('complete');
        });
    });
});

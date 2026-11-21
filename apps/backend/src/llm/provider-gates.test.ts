/**
 * The rules about what may be sent are the same whichever provider is set: photos, camera-EXIF images, unclassified
 * images, private and trashed items never reach the model, a local server included. Runs the real pipeline entry
 * (processDocument) with the provider a setting names, and counts what each provider was sent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    parse: vi.fn(),
    create: vi.fn(),
    fetch: vi.fn(),
    file: Buffer.alloc(0),
    enqueueTextEmbedding: vi.fn(),
}));

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('./anthropic.client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./anthropic.client')>()),
    getAnthropicClient: () => ({ messages: { parse: h.parse, create: h.create } }),
}));
// Vision is off in the environment on purpose: the admin's setting is what turns it on.
vi.mock('../config/env', async (importOriginal) => ({
    env: {
        ...(await importOriginal<typeof import('../config/env')>()).env,
        ANTHROPIC_API_KEY: 'test-key',
        LLM_ENABLED: true,
        LLM_VISION_ENABLED: false,
        LOCAL_LLM_TIMEOUT_MS: 5000,
    },
}));
vi.mock('../services/storage.service', () => ({
    assertFitsInMemory: () => undefined,
    getStorageService: () => ({ getFile: async () => h.file }),
}));
vi.mock('../embeddings/enqueue', () => ({ enqueueTextEmbedding: h.enqueueTextEmbedding }));

import type { Database } from '../db/schema';
import { dbProxy } from '../testing/db-proxy.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { LlmAnalysisSchema, LlmImageUnderstandingSchema } from './llm-response.schema';
import { processDocument } from './llm.service';
import { resetJsonModes } from './openai-compatible.provider';

const SCREENSHOT = readFileSync(join(__dirname, 'fixtures', 'synthetic-terminal-screenshot.png'));
const ANALYSIS = LlmAnalysisSchema.parse({
    summary: 'A note.',
    title: 'Note',
    document_type: 'other',
    language: 'en',
    entities: [],
    topics: [],
    tags: ['note'],
    extracted_date: null,
});
const IMAGE_ANSWER = LlmImageUnderstandingSchema.parse({
    kind: 'screenshot',
    app_or_source: 'Terminal',
    title: 'Terminal',
    summary: 'A terminal.',
    document_type: null,
    language: 'en',
    entities: [],
    topics: [],
    tags: ['terminal'],
    extracted_date: null,
});
const USAGE = { input_tokens: 100, output_tokens: 20 };

interface ChatBody {
    messages: { role: string; content: string | { type: string }[] }[];
}

/** Every image either provider was sent, however it is wrapped (an Anthropic image block, or an OpenAI image_url part). */
function countImagesSent(): number {
    const anthropic = [...h.parse.mock.calls, ...h.create.mock.calls]
        .map((call) => JSON.stringify(call[0]))
        .filter((body) => body.includes('"type":"image"')).length;
    const local = h.fetch.mock.calls.map((call) => JSON.stringify(JSON.parse(call[1].body))).filter((body) => body.includes('image_url')).length;

    return anthropic + local;
}

const callsToEitherProvider = () => h.parse.mock.calls.length + h.create.mock.calls.length + h.fetch.mock.calls.length;

describe.each([['anthropic'], ['openai-compatible']] as const)('gates with the %s provider', (provider) => {
    describeDb('processDocument', () => {
        let database: TestDatabase;
        let db: Kysely<Database>;
        let userId: string;
        let lockedFolderId: string;

        beforeAll(async () => {
            database = await createTestDatabase();
            db = database.db;
            dbProxy.use(db);
            userId = await seedUser(db, 'owner');
            lockedFolderId = (await seedFolder(db, userId, 'vault', { isPrivate: true })).id;
        }, 60_000);
        afterAll(async () => {
            await database?.close();
        });

        async function setSettings(values: Record<string, unknown>) {
            await db.deleteFrom('server_settings').execute();

            for (const [key, value] of Object.entries(values)) {
                await db
                    .insertInto('server_settings')
                    .values({ key, value: JSON.stringify(value), updated_at: new Date(), updated_by: null })
                    .execute();
            }
        }

        beforeEach(async () => {
            await db.deleteFrom('documents').execute();
            resetJsonModes();
            vi.spyOn(console, 'info').mockImplementation(() => undefined);
            h.parse.mockReset();
            h.create.mockReset();
            h.fetch.mockReset();
            h.enqueueTextEmbedding.mockReset();
            h.file = SCREENSHOT;
            h.parse.mockImplementation(async (request: { messages: { content: unknown }[] }) => ({
                parsed_output:
                    Array.isArray(request.messages[0]!.content) && JSON.stringify(request.messages[0]!.content).includes('"type":"image"')
                        ? IMAGE_ANSWER
                        : ANALYSIS,
                stop_reason: 'end_turn',
                usage: USAGE,
            }));
            h.fetch.mockImplementation(async (_url: string, init: { body: string }) => {
                const body = JSON.parse(init.body) as ChatBody;
                const isImage = Array.isArray(body.messages[1]!.content);

                return new Response(
                    JSON.stringify({
                        choices: [{ message: { content: JSON.stringify(isImage ? IMAGE_ANSWER : ANALYSIS) }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 100, completion_tokens: 20 },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            });
            vi.stubGlobal('fetch', h.fetch);

            const local = provider === 'openai-compatible';

            await setSettings({
                'llm.image.enabled': true,
                ...(local && {
                    'llm.summary.provider': 'openai-compatible',
                    'llm.summary.model': 'llama3.1:8b',
                    'llm.summary.baseUrl': 'http://local-llm:11434/v1',
                    'llm.image.provider': 'openai-compatible',
                    'llm.image.model': 'llava:13b',
                    'llm.image.baseUrl': 'http://local-llm:11434/v1',
                }),
            });
        });

        async function seedImage(opts: {
            category: string | null;
            verdict?: string;
            folderId?: string;
            deleted?: boolean;
            ocrText?: string;
            camera?: boolean;
        }) {
            const id = await seedDocument(db, {
                userId,
                name: 'img.png',
                mime: 'image/png',
                category: opts.category,
                ...(opts.folderId && { folderId: opts.folderId }),
                ...(opts.deleted && { deleted: true }),
                ...(opts.ocrText !== undefined && { ocrText: opts.ocrText }),
                ...(opts.camera && { cameraReadAt: new Date(), photo: { cameraMake: 'Apple', cameraModel: 'iPhone 15' } }),
            });

            // The seed's OCR confidence (0.9) is below the minimum for sending text; a real OCR run reports a percentage.
            await db.updateTable('ocr_results').set({ confidence_score: 90 }).where('document_id', '=', id).execute();

            if (opts.verdict) {
                await db
                    .insertInto('document_image_kinds')
                    .values({ document_id: id, kind: opts.verdict, scores: '{}', signals: '{}', prompt_version: 'test', model: 'test', model_version: '1' })
                    .execute();
            }

            return id;
        }

        it('sends a classified screenshot, switched on by the setting alone, and stores the result', async () => {
            const id = await seedImage({ category: 'screenshot', verdict: 'screenshot' });
            const result = await processDocument(id);

            expect(result).toMatchObject({ success: true, tokenCount: 120 });
            expect(countImagesSent()).toBe(1);

            const row = await db.selectFrom('llm_results').selectAll().where('document_id', '=', id).executeTakeFirstOrThrow();

            expect(row.processing_type).toBe('image_understanding');
            expect(row.token_count).toBe(120);
            expect(h.fetch.mock.calls.length).toBe(provider === 'openai-compatible' ? 1 : 0);
        });

        it.each([
            ['a photo', { category: 'photo', verdict: 'photo' }],
            ['an image whose category says photo, whatever its verdict', { category: 'photo', verdict: 'screenshot' }],
            ['an image with camera EXIF, even one classified as a screenshot', { category: 'screenshot', verdict: 'screenshot', camera: true }],
            ['an image nobody has classified', { category: 'screenshot' }],
            ['an image still without a category', { category: null, verdict: 'screenshot' }],
        ])('never sends %s', async (_label, opts) => {
            const id = await seedImage(opts);
            const result = await processDocument(id);

            expect(result).toMatchObject({ success: true, skipped: true });
            expect(callsToEitherProvider()).toBe(0);
            expect(await db.selectFrom('llm_results').select('id').where('document_id', '=', id).execute()).toHaveLength(0);
        });

        it('gives a photo that has OCR text the text summary only: no pixels', async () => {
            const id = await seedImage({
                category: 'photo',
                verdict: 'photo',
                ocrText: 'Opening hours Monday to Friday nine to five at the shop on the corner',
            });

            await processDocument(id);

            expect(callsToEitherProvider()).toBe(1);
            expect(countImagesSent()).toBe(0);
        });

        it('never sends an image in a private folder', async () => {
            const id = await seedImage({ category: 'screenshot', verdict: 'screenshot', folderId: lockedFolderId });

            expect(await processDocument(id)).toMatchObject({ skipped: true, reason: 'private' });
            expect(callsToEitherProvider()).toBe(0);
        });

        it('never sends the text of a private document, or of a trashed one', async () => {
            const text = 'Quarterly report with enough words in it to be summarised by a model that is asked to';
            const privateDoc = await seedDocument(db, { userId, name: 'secret.pdf', folderId: lockedFolderId, ocrText: text });
            const trashed = await seedDocument(db, { userId, name: 'old.pdf', deleted: true, ocrText: text });

            expect(await processDocument(privateDoc)).toMatchObject({ skipped: true, reason: 'private' });
            expect(await processDocument(trashed)).toMatchObject({ skipped: true, reason: 'trashed' });
            expect(callsToEitherProvider()).toBe(0);
        });

        it('never sends an image in the trash', async () => {
            const id = await seedImage({ category: 'screenshot', verdict: 'screenshot', deleted: true });

            expect(await processDocument(id)).toMatchObject({ skipped: true, reason: 'trashed' });
            expect(callsToEitherProvider()).toBe(0);
        });

        it('sends no pixels when "model sees images" is switched off, even for a classified screenshot', async () => {
            await setSettings({ 'llm.image.enabled': false });

            const id = await seedImage({
                category: 'screenshot',
                verdict: 'screenshot',
                ocrText: 'PASS src/cart.test.ts and another dozen words so that the text is long enough',
            });

            await processDocument(id);

            expect(countImagesSent()).toBe(0);
            expect(callsToEitherProvider()).toBe(1);
        });
    });
});

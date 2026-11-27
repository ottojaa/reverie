import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

/** The lane each job's document was in at the moment the job was queued. */
const lanesWhenQueued = vi.hoisted(() => [] as string[]);

const recordLane = vi.hoisted(() => async (data: { documentId: string }) => {
    const { dbProxy } = await import('../testing/db-proxy.js');
    const row = await dbProxy.db.selectFrom('documents').select('processing_lane').where('id', '=', data.documentId).executeTakeFirstOrThrow();

    lanesWhenQueued.push(row.processing_lane);
});

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env', () => ({
    env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', LLM_ENABLED: true, LLM_MIN_OCR_CONFIDENCE: 0 },
}));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: recordLane }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: recordLane }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: recordLane }));

import { seedDocument, type SeedDocument } from '../testing/seed.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import documentsRoute from './routes/documents.route.js';

const TEXT = 'An invoice from the harbour office for the mooring fee, payable within fourteen days of the date above. '.repeat(3);

describeDb('manual processing of a background document', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let counter = 0;

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        for (const plugin of [sensible, authPlugin, errorHandler, documentsRoute]) await app.register(plugin);
        await app.ready();
    }, 60_000);
    beforeEach(() => void (lanesWhenQueued.length = 0));
    afterAll(() => app.close());

    async function seedBackground(extra: Partial<SeedDocument> = {}): Promise<string> {
        const { db, alice } = ctx.world();
        const id = await seedDocument(db, { userId: alice, name: `backup-${++counter}.pdf`, ocrText: TEXT, ...extra });

        await db.updateTable('documents').set({ processing_lane: 'background' }).where('id', '=', id).execute();

        return id;
    }

    async function post(url: string, payload?: object) {
        return app.inject({
            method: 'POST',
            url,
            payload,
            headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: ctx.world().alice, email: 'x@example.test' } as never) },
        });
    }

    it.each([
        { endpoint: 'ocr', seed: { statuses: { ocr: 'failed' as const } }, payload: undefined },
        { endpoint: 'ocr/retry', seed: {}, payload: undefined },
        { endpoint: 'process-llm', seed: {}, payload: undefined },
        { endpoint: 'reprocess-llm', seed: {}, payload: undefined },
        { endpoint: 'trim', seed: { mime: 'video/mp4' }, payload: { start: 0, end: 2, saveAsCopy: false } },
    ])('POST /documents/:id/$endpoint promotes the document before it queues the job', async ({ endpoint, seed, payload }) => {
        const id = await seedBackground(seed);
        const response = await post(`/documents/${id}/${endpoint}`, payload);

        expect(response.statusCode).toBe(200);
        expect(lanesWhenQueued).toEqual(['normal']);
    });

    it('POST /documents/batch-process-llm promotes each document it queues', async () => {
        const ids = [await seedBackground(), await seedBackground()];
        const response = await post('/documents/batch-process-llm', { document_ids: ids });

        expect(response.statusCode).toBe(200);
        expect(lanesWhenQueued).toEqual(['normal', 'normal']);
    });
});

import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env', async () => ({ env: (await import('../testing/upload-env.js')).testEnv }));
vi.mock('../queues/ocr.queue', async () => (await import('../testing/upload-env.js')).ocrQueueStub);
vi.mock('../queues/thumbnail.queue', async () => (await import('../testing/upload-env.js')).thumbnailQueueStub);

import { describeDb, useWorld } from '../testing/tool-world.js';
import { storageRoot } from '../testing/upload-env.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import multipartPlugin from './plugins/multipart.js';
import uploadRoute from './routes/upload.route.js';

const BOUNDARY = 'lane-test-boundary';

/** A multipart upload of one text file, with the `lane` field when there is one. */
function toUploadBody(filename: string, lane?: string): string {
    const field = lane === undefined ? [] : [`--${BOUNDARY}`, 'Content-Disposition: form-data; name="lane"', '', lane];

    return [
        ...field,
        `--${BOUNDARY}`,
        `Content-Disposition: form-data; name="files"; filename="${filename}"`,
        'Content-Type: text/plain',
        '',
        'content of ' + filename,
        `--${BOUNDARY}--`,
        '',
    ].join('\r\n');
}

describeDb('POST /upload with a lane', () => {
    const ctx = useWorld();
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        for (const plugin of [sensible, authPlugin, errorHandler, multipartPlugin, uploadRoute]) await app.register(plugin);
        await app.ready();

        const { db, alice } = ctx.world();

        await db.updateTable('users').set({ storage_quota_bytes: 100_000_000, storage_path: 'users/alice' }).where('id', '=', alice).execute();
    }, 60_000);
    afterAll(async () => {
        await app?.close();
        await rm(storageRoot, { recursive: true, force: true });
    });

    it.each([
        { sent: undefined, stored: 'normal' },
        { sent: 'background', stored: 'background' },
        { sent: 'normal', stored: 'normal' },
        { sent: 'urgent', stored: 'normal' },
        { sent: '', stored: 'normal' },
    ])('stores a document sent with lane $sent as $stored', async ({ sent, stored }) => {
        const { db, alice } = ctx.world();
        const response = await app.inject({
            method: 'POST',
            url: '/upload',
            headers: {
                authorization: 'Bearer ' + app.jwt.sign({ sub: alice, email: 'x@example.test' } as never),
                'content-type': 'multipart/form-data; boundary=' + BOUNDARY,
            },
            payload: toUploadBody(`lane-${sent ?? 'absent'}.txt`, sent),
        });

        expect(response.statusCode).toBe(200);

        const id = (JSON.parse(response.body) as { documents: Array<{ id: string }> }).documents[0]!.id;
        const document = await db.selectFrom('documents').select('processing_lane').where('id', '=', id).executeTakeFirstOrThrow();

        expect(document.processing_lane).toBe(stored);
    });
});

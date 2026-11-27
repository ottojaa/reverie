import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// The config reads the environment as it is imported, so this file's own Redis starts, and sets it, just before.
const queueTest = vi.hoisted(() => ({}) as { env: QueueEnv });

vi.mock('../config/env', async (importOriginal) => {
    queueTest.env = await (await import('../testing/queue-env.js')).startQueueEnv();

    return importOriginal();
});

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../transcode/service', () => ({ transcodeDocument: vi.fn() }));
// The backfill would queue these videos itself, in a race with the test.
vi.mock('../transcode/backfill', () => ({ isTranscodePipelineBusy: async () => false, runTranscodeBackfillPage: async () => ({ kind: 'wait' }) }));
vi.mock('../transcode/capabilities', () => ({ getCapabilities: async () => ({ nvenc: false, zscale: false }) }));
vi.mock('../transcode/ffmpeg-run', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../transcode/ffmpeg-run')>();

    return { ...actual, createFfmpegRunner: vi.fn(actual.createFfmpegRunner) };
});

import type { ProcessingLane } from '@reverie/shared';
import type { Worker } from 'bullmq';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { closeAllQueues } from '../queues';
import { dbProxy } from '../testing/db-proxy.js';
import type { QueueEnv } from '../testing/queue-env.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { createFfmpegRunner } from '../transcode/ffmpeg-run';
import { queueTranscode } from '../transcode/queue-transcode';
import { transcodeDocument, type TranscodeDeps } from '../transcode/service';
import { createBackgroundTranscodeWorker, createTranscodeWorker } from './transcode.worker';

/** Both real transcode workers on a real Redis; only the encode itself is stood in for. */
describeDb('transcode lanes', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let workers: Worker[] = [];

    let finishBackgroundEncode = () => {};

    beforeAll(async () => {
        database = await createTestDatabase();
        dbProxy.use(database.db);
        db = database.db;
        userId = await seedUser(db, 'owner');
    }, 60_000);
    afterAll(async () => {
        finishBackgroundEncode();
        await Promise.all(workers.map((worker) => worker.close()));
        await closeAllQueues();
        await database?.close();
        await queueTest.env.stop();
    });

    async function seedVideo(name: string, lane: ProcessingLane): Promise<string> {
        const id = await seedDocument(db, { userId, name, mime: 'video/mp4', transcodeStatus: 'pending' });

        await db.updateTable('documents').set({ processing_lane: lane }).where('id', '=', id).execute();

        return id;
    }

    const jobStatus = async (documentId: string) =>
        (await db.selectFrom('processing_jobs').select('status').where('target_id', '=', documentId).executeTakeFirstOrThrow()).status;

    const waitForStatus = (documentId: string, status: string) =>
        vi.waitFor(async () => expect(await jobStatus(documentId)).toBe(status), { timeout: 15_000, interval: 50 });

    it('encodes a normal video while a background encode is still running', async () => {
        const background = await seedVideo('camera-roll.mp4', 'background');
        const normal = await seedVideo('manual.mp4', 'normal');
        const held = new Promise<void>((resolve) => (finishBackgroundEncode = resolve));
        const deps = new Map<string, TranscodeDeps>();

        vi.mocked(transcodeDocument).mockImplementation(async (used, documentId) => {
            deps.set(documentId, used);

            if (documentId === background) await held;

            return {};
        });
        workers = [createTranscodeWorker(), createBackgroundTranscodeWorker()];

        await queueTranscode(db, background, userId);
        await waitForStatus(background, 'processing');
        await queueTranscode(db, normal, userId);
        await waitForStatus(normal, 'complete');

        expect(await jobStatus(background)).toBe('processing');
        // Only the background encode is niced and capped.
        expect(deps.get(background)!.threads).toBe(2);
        expect(deps.get(normal)!.threads).toBeUndefined();
        expect(vi.mocked(createFfmpegRunner).mock.calls).toEqual([[10]]);

        finishBackgroundEncode();
        await waitForStatus(background, 'complete');
    }, 60_000);
});

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// The config reads the environment as it is imported, so this file's own Redis starts, and sets it, just before.
const queueTest = vi.hoisted(() => ({}) as { env: QueueEnv });

vi.mock('../config/env', async (importOriginal) => {
    queueTest.env = await (await import('../testing/queue-env.js')).startQueueEnv();

    return importOriginal();
});

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { ProcessingLane } from '@reverie/shared';
import type { Queue, Worker } from 'bullmq';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import type { Database, JobType } from '../db/schema';
import { addOcrJob, addThumbnailJob, closeAllQueues, getBackgroundOcrQueue, getBackgroundThumbnailQueue } from '../queues';
import { dbProxy } from '../testing/db-proxy.js';
import type { QueueEnv } from '../testing/queue-env.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { createBackgroundOcrWorker, createOcrWorker } from './ocr.worker';
import { createBackgroundThumbnailWorker, createThumbnailWorker } from './thumbnail.worker';

interface Lane {
    step: string;
    jobType: JobType;
    /** A file the real processor finishes without an OCR engine or ffmpeg. */
    mime: string;
    add: typeof addOcrJob | typeof addThumbnailJob;
    backgroundQueue: () => Queue;
    startNormalWorker: () => Worker;
    startBackgroundWorker: () => Worker;
}

const LANES: Lane[] = [
    {
        step: 'OCR',
        jobType: 'ocr',
        mime: 'application/zip',
        add: addOcrJob,
        backgroundQueue: getBackgroundOcrQueue,
        startNormalWorker: createOcrWorker,
        startBackgroundWorker: createBackgroundOcrWorker,
    },
    {
        step: 'thumbnail',
        jobType: 'thumbnail',
        mime: 'image/jpeg',
        add: addThumbnailJob,
        backgroundQueue: getBackgroundThumbnailQueue,
        startNormalWorker: createThumbnailWorker,
        startBackgroundWorker: createBackgroundThumbnailWorker,
    },
];

/** The real OCR and thumbnail workers of both lanes on a real Redis. */
describeDb('background OCR and thumbnail lanes', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    const workers: Worker[] = [];

    beforeAll(async () => {
        database = await createTestDatabase();
        dbProxy.use(database.db);
        db = database.db;
        userId = await seedUser(db, 'owner');
        await mkdir(queueTest.env.storageRoot, { recursive: true });
        const raw = { width: 8, height: 8, channels: 3 as const, background: '#808080' };
        await writeFile(join(queueTest.env.storageRoot, 'photo.jpg'), await sharp({ create: raw }).jpeg().toBuffer());
    }, 60_000);
    afterAll(async () => {
        await Promise.all(workers.map((worker) => worker.close()));
        await closeAllQueues();
        await database?.close();
        await queueTest.env.stop();
    });

    async function queueJob(lane: Lane, processingLane: ProcessingLane): Promise<string> {
        const documentId = await seedDocument(db, { userId, name: randomUUID(), mime: lane.mime });

        await db.updateTable('documents').set({ processing_lane: processingLane }).where('id', '=', documentId).execute();
        const { id } = await db
            .insertInto('processing_jobs')
            .values({ user_id: userId, job_type: lane.jobType, target_type: 'document', target_id: documentId, status: 'pending' })
            .returning('id')
            .executeTakeFirstOrThrow();
        await lane.add({ documentId, userId, filePath: 'photo.jpg' }, id);

        return id;
    }

    const jobRow = (jobId: string) =>
        db.selectFrom('processing_jobs').select(['status', 'attempts', 'started_at', 'completed_at']).where('id', '=', jobId).executeTakeFirstOrThrow();

    const waitForCompletion = (jobId: string) =>
        vi.waitFor(async () => expect((await jobRow(jobId)).status).toBe('complete'), { timeout: 15_000, interval: 50 });

    it.each(LANES)(
        '$step: starts no background job while a normal one has not finished, and runs it afterwards',
        async (lane) => {
            const background = await queueJob(lane, 'background');
            // No normal worker yet, so this one stays waiting.
            const normal = await queueJob(lane, 'normal');
            const held = lane.startBackgroundWorker();
            let picked = 0;
            let failures = 0;
            held.on('active', () => picked++);
            held.on('failed', () => failures++);
            workers.push(held);

            await sleep(3_500);

            // Looked at again every couple of seconds, not in a spin.
            expect(picked).toBeGreaterThanOrEqual(1);
            expect(picked).toBeLessThanOrEqual(3);
            expect(failures).toBe(0);
            expect(await jobRow(background)).toMatchObject({ status: 'pending', attempts: 0, started_at: null });
            expect((await lane.backgroundQueue().getJob(background))?.attemptsMade).toBe(0);

            workers.push(lane.startNormalWorker());
            await waitForCompletion(background);

            const [first, second] = [await jobRow(normal), await jobRow(background)];
            expect(first.status).toBe('complete');
            expect(second.started_at!.getTime()).toBeGreaterThanOrEqual(first.completed_at!.getTime());
            expect(second.attempts).toBe(0);
        },
        30_000,
    );
});

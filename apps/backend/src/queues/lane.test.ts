import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// The config reads the environment as it is imported, so this file's own Redis starts, and sets it, just before.
const queueTest = vi.hoisted(() => ({}) as { env: QueueEnv });

vi.mock('../config/env', async (importOriginal) => {
    queueTest.env = await (await import('../testing/queue-env.js')).startQueueEnv();

    return importOriginal();
});

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { ProcessingLane } from '@reverie/shared';
import type { Queue } from 'bullmq';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import type { Database } from '../db/schema';
import { getUploadService, type UploadedFile } from '../services/upload.service';
import { dbProxy } from '../testing/db-proxy.js';
import type { QueueEnv } from '../testing/queue-env.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { queueTranscode } from '../transcode/queue-transcode';
import {
    addEmbedJob,
    addLlmJob,
    addOcrJob,
    addThumbnailJob,
    addTranscodeJob,
    addTrimJob,
    closeAllQueues,
    EMBED_JOBS,
    getBackgroundOcrQueue,
    getBackgroundThumbnailQueue,
    getBackgroundTranscodeQueue,
    getEmbedQueue,
    getLlmQueue,
    getOcrQueue,
    getThumbnailQueue,
    getTranscodeQueue,
    getTrimQueue,
    promoteToNormal,
} from './index';
import { BACKFILL_PRIORITY } from './transcode.queue';

/** Behind every number a normal job is queued with (unprioritised, 5 and 10). */
const BEHIND = 100;

interface Step {
    step: string;
    add: (documentId: string, userId: string) => Promise<unknown>;
    queue: () => Queue;
    backgroundQueue?: () => Queue;
    /** The priority a normal document's job has: what it was before there were lanes. 0 is unprioritised. */
    normal: number;
}

const STEPS: Step[] = [
    {
        step: 'OCR',
        add: (documentId, userId) => addOcrJob({ documentId, userId, filePath: 'a' }, randomUUID()),
        queue: getOcrQueue,
        backgroundQueue: getBackgroundOcrQueue,
        normal: 0,
    },
    {
        step: 'thumbnail',
        add: (documentId, userId) => addThumbnailJob({ documentId, userId, filePath: 'a' }, randomUUID()),
        queue: getThumbnailQueue,
        backgroundQueue: getBackgroundThumbnailQueue,
        normal: 10,
    },
    { step: 'LLM', add: (documentId, userId) => addLlmJob({ documentId, userId }, randomUUID()), queue: getLlmQueue, normal: 0 },
    {
        step: 'trim',
        add: (documentId, userId) => addTrimJob({ documentId, userId, start: 0, end: 1, saveAsCopy: false }, randomUUID()),
        queue: getTrimQueue,
        normal: 5,
    },
    { step: 'embedding', add: (documentId) => addEmbedJob(EMBED_JOBS.TEXT, documentId), queue: getEmbedQueue, normal: 0 },
    {
        step: 'embedding backfill',
        add: (documentId) => addEmbedJob(EMBED_JOBS.IMAGE, documentId, BACKFILL_PRIORITY),
        queue: getEmbedQueue,
        normal: 10,
    },
    {
        step: 'transcode',
        add: (documentId, userId) => addTranscodeJob({ documentId, userId }, randomUUID()),
        queue: getTranscodeQueue,
        backgroundQueue: getBackgroundTranscodeQueue,
        normal: 0,
    },
    {
        step: 'transcode backfill',
        add: (documentId, userId) => addTranscodeJob({ documentId, userId }, randomUUID(), BACKFILL_PRIORITY),
        queue: getTranscodeQueue,
        backgroundQueue: getBackgroundTranscodeQueue,
        normal: 10,
    },
];

/** The priorities of the jobs a queue holds for one document. No worker runs here, so they all wait. */
async function queuedPriorities(queue: Queue, documentId: string): Promise<number[]> {
    const jobs = await queue.getJobs(['waiting', 'prioritized']);

    return jobs.filter((job) => job.data.documentId === documentId).map((job) => job.opts.priority ?? 0);
}

describeDb('processing lanes in the queues', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let files = 0;

    beforeAll(async () => {
        database = await createTestDatabase();
        dbProxy.use(database.db);
        db = database.db;
        userId = await seedUser(db, 'owner');
        await db.updateTable('users').set({ storage_quota_bytes: 100_000_000, storage_path: 'users/owner' }).where('id', '=', userId).execute();
    }, 60_000);
    afterAll(async () => {
        await closeAllQueues();
        await database?.close();
        await queueTest.env.stop();
    });

    async function seedIn(lane: ProcessingLane, name = randomUUID() + '.mp4'): Promise<string> {
        const id = await seedDocument(db, { userId, name, mime: 'video/mp4' });

        await db.updateTable('documents').set({ processing_lane: lane }).where('id', '=', id).execute();

        return id;
    }

    /** A photo as the upload route hands it over: a file in a temporary place. */
    async function newPhoto(): Promise<UploadedFile> {
        const raw = { width: 8, height: 8, channels: 3 as const };
        const buffer = await sharp(randomBytes(8 * 8 * 3), { raw })
            .jpeg()
            .toBuffer();
        const tempPath = join(queueTest.env.storageRoot, 'incoming-' + ++files);

        await writeFile(tempPath, buffer);

        return { tempPath, size: buffer.length, hash: randomUUID().replaceAll('-', ''), filename: `photo-${files}.jpg`, mimetype: 'image/jpeg' };
    }

    async function upload(lane?: ProcessingLane): Promise<string> {
        const result = await getUploadService().uploadFiles([await newPhoto()], userId, undefined, undefined, undefined, undefined, lane);

        return result.documents[0]!.id;
    }

    const laneOf = async (id: string) =>
        (await db.selectFrom('documents').select('processing_lane').where('id', '=', id).executeTakeFirstOrThrow()).processing_lane;

    it.each(STEPS)('$step: a normal document keeps the priority it had', async ({ add, queue, normal }) => {
        const id = await seedIn('normal');

        await add(id, userId);

        expect(await queuedPriorities(queue(), id)).toEqual([normal]);
    });

    it.each(STEPS)('$step: a background document goes behind every normal job', async ({ add, queue, backgroundQueue }) => {
        const id = await seedIn('background');

        await add(id, userId);

        expect(await queuedPriorities((backgroundQueue ?? queue)(), id)).toEqual([BEHIND]);

        if (backgroundQueue) expect(await queuedPriorities(queue(), id)).toEqual([]);
    });

    it('queues the first jobs of a background upload behind, and of any other upload as before', async () => {
        const background = await upload('background');
        const normal = await upload();

        expect([await laneOf(background), await laneOf(normal)]).toEqual(['background', 'normal']);
        expect(await queuedPriorities(getBackgroundOcrQueue(), background)).toEqual([BEHIND]);
        expect(await queuedPriorities(getBackgroundThumbnailQueue(), background)).toEqual([BEHIND]);
        expect(await queuedPriorities(getOcrQueue(), background)).toEqual([]);
        expect(await queuedPriorities(getThumbnailQueue(), background)).toEqual([]);
        expect(await queuedPriorities(getOcrQueue(), normal)).toEqual([0]);
        expect(await queuedPriorities(getThumbnailQueue(), normal)).toEqual([10]);
    });

    it('sends the transcode that follows a background video’s thumbnail to the background queue', async () => {
        const background = await seedIn('background');
        const normal = await seedIn('normal');

        await queueTranscode(db, background, userId);
        await queueTranscode(db, normal, userId);

        expect(await queuedPriorities(getBackgroundTranscodeQueue(), background)).toEqual([BEHIND]);
        expect(await queuedPriorities(getTranscodeQueue(), background)).toEqual([]);
        expect(await queuedPriorities(getTranscodeQueue(), normal)).toEqual([0]);
        expect(await queuedPriorities(getBackgroundTranscodeQueue(), normal)).toEqual([]);
    });

    it('treats a document as normal from the moment it is promoted', async () => {
        const id = await seedIn('background');

        await promoteToNormal(id);
        await addOcrJob({ documentId: id, userId, filePath: 'a' }, randomUUID());
        await addTranscodeJob({ documentId: id, userId }, randomUUID());

        expect(await laneOf(id)).toBe('normal');
        expect(await queuedPriorities(getOcrQueue(), id)).toEqual([0]);
        expect(await queuedPriorities(getTranscodeQueue(), id)).toEqual([0]);
    });

    it('promotes a backed-up photo that is saved over, so the new content is processed ahead of the backlog', async () => {
        const id = await upload('background');

        await getUploadService().replaceDocumentFile(id, userId, await newPhoto());

        expect(await laneOf(id)).toBe('normal');
        expect(await queuedPriorities(getOcrQueue(), id)).toEqual([0]);
        expect(await queuedPriorities(getThumbnailQueue(), id)).toEqual([10]);
    });
});

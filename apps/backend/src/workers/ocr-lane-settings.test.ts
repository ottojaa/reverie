import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// The config reads the environment as it is imported, so this file's own Redis starts, and sets it, just before.
const queueTest = vi.hoisted(() => ({}) as { env: QueueEnv });

vi.mock('../config/env', async (importOriginal) => {
    queueTest.env = await (await import('../testing/queue-env.js')).startQueueEnv();
    Object.assign(process.env, {
        OCR_ENGINE: 'paddleocr',
        PYTHON_PATH: join(__dirname, '../testing/fake-ocr-runner.mjs'),
    });

    return importOriginal();
});

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

// Starting the OCR client kills leftover runners by path; a test must not touch processes on this machine. The test
// database starts through the same function, so everything else goes through.
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();
    const execFileSync = (file: string, args: string[], options: ExecFileSyncOptions) => (file === 'pkill' ? '' : actual.execFileSync(file, args, options));

    return { ...actual, execFileSync };
});

import type { ProcessingLane } from '@reverie/shared';
import type { Worker } from 'bullmq';
import type { ExecFileSyncOptions } from 'child_process';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import type { Database } from '../db/schema';
import { shutdownPaddleOcr } from '../ocr/paddleocr.client';
import { addOcrJob, closeAllQueues } from '../queues';
import { dbProxy } from '../testing/db-proxy.js';
import type { QueueEnv } from '../testing/queue-env.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { createBackgroundOcrWorker, createOcrWorker } from './ocr.worker';

const FILES = [
    { kind: 'an image', mime: 'image/jpeg', path: 'photo.jpg' },
    { kind: 'a PDF', mime: 'application/pdf', path: 'scan.pdf' },
];

/** The real OCR workers of both lanes, down to the request the OCR process receives. */
describeDb('OCR settings by lane', () => {
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
        const raw = { width: 200, height: 200, channels: 3 as const, background: '#808080' };
        await writeFile(join(queueTest.env.storageRoot, 'photo.jpg'), await sharp({ create: raw }).jpeg().toBuffer());
        await writeFile(join(queueTest.env.storageRoot, 'scan.pdf'), '%PDF-1.4');
        workers.push(createOcrWorker(), createBackgroundOcrWorker());
    }, 60_000);
    afterAll(async () => {
        await Promise.all(workers.map((worker) => worker.close()));
        await shutdownPaddleOcr();
        await closeAllQueues();
        await database?.close();
        await queueTest.env.stop();
    });

    /** Runs a document's OCR job through its lane's worker; returns the request the fake OCR process echoed as its text. */
    async function runOcrJob(processingLane: ProcessingLane, file: (typeof FILES)[number]): Promise<Record<string, unknown>> {
        const documentId = await seedDocument(db, { userId, name: randomUUID(), mime: file.mime });

        await db.updateTable('documents').set({ processing_lane: processingLane, file_path: file.path }).where('id', '=', documentId).execute();
        const { id } = await db
            .insertInto('processing_jobs')
            .values({ user_id: userId, job_type: 'ocr', target_type: 'document', target_id: documentId, status: 'pending' })
            .returning('id')
            .executeTakeFirstOrThrow();
        await addOcrJob({ documentId, userId, filePath: file.path }, id);

        const result = await vi.waitFor(() => db.selectFrom('ocr_results').select('raw_text').where('document_id', '=', documentId).executeTakeFirstOrThrow(), {
            timeout: 15_000,
            interval: 50,
        });

        return JSON.parse(result.raw_text) as Record<string, unknown>;
    }

    it.each(FILES)(
        "sends the background settings with $kind from the background worker, and none from the normal one's",
        async (file) => {
            expect(await runOcrJob('background', file)).toMatchObject({
                settings: { use_doc_unwarping: false, use_doc_orientation_classify: true, text_det_limit_side_len: 1920, text_det_limit_type: 'max' },
            });
            expect(await runOcrJob('normal', file)).not.toHaveProperty('settings');
        },
        40_000,
    );
});

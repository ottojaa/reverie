import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// The config reads the environment as it is imported, so this file's own Redis starts, and sets it, just before.
const queueTest = vi.hoisted(() => ({}) as { env: QueueEnv });
/** The summaries now running, and releases for each in the order they started. */
const llm = vi.hoisted(() => ({ running: [] as string[], releases: [] as (() => void)[] }));

vi.mock('../config/env', async (importOriginal) => {
    queueTest.env = await (await import('../testing/queue-env.js')).startQueueEnv();

    return importOriginal();
});
vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../llm/llm.service', () => ({
    processDocument: async (documentId: string) => {
        llm.running.push(documentId);
        await new Promise<void>((resolve) => llm.releases.push(resolve));
        llm.running.splice(llm.running.indexOf(documentId), 1);

        return { success: true, skipped: false };
    },
}));

import type { Worker } from 'bullmq';
import { closeAllQueues } from '../queues';
import { addLlmJob } from '../queues/llm.queue';
import { dbProxy } from '../testing/db-proxy.js';
import type { QueueEnv } from '../testing/queue-env.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { createLlmWorker } from './llm.worker';

describeDb('the LLM worker', () => {
    let database: TestDatabase;
    let userId: string;
    let worker: Worker;

    beforeAll(async () => {
        database = await createTestDatabase();
        dbProxy.use(database.db);
        userId = await seedUser(database.db, 'owner');
        worker = createLlmWorker();
    }, 60_000);
    afterAll(async () => {
        await worker?.close();
        await closeAllQueues();
        await database?.close();
        await queueTest.env.stop();
    });

    async function queueSummary(documentId: string): Promise<void> {
        const job = await database.db
            .insertInto('processing_jobs')
            .values({ user_id: userId, job_type: 'llm_summary', target_type: 'document', target_id: documentId, status: 'pending' })
            .returning('id')
            .executeTakeFirstOrThrow();

        await addLlmJob({ documentId, userId, type: 'text_summary' }, job.id);
    }

    it('runs the jobs of different documents side by side, and those of one document one at a time', async () => {
        const [twice, other] = [
            await seedDocument(database.db, { userId, name: 'twice.txt', ocrText: 'words' }),
            await seedDocument(database.db, { userId, name: 'other.txt', ocrText: 'words' }),
        ];

        await queueSummary(twice);
        await queueSummary(twice);
        await queueSummary(other);
        await vi.waitFor(() => expect([...llm.running].sort()).toEqual([twice, other].sort()), { timeout: 10_000 });
        // Time for the second job of the document to start, were it not made to wait.
        await sleep(300);

        expect(llm.running).toHaveLength(2);
        llm.releases.splice(0).forEach((release) => release());
        await vi.waitFor(() => expect(llm.running).toEqual([twice]), { timeout: 10_000 });
        llm.releases.splice(0).forEach((release) => release());
        await vi.waitFor(
            async () => {
                const jobs = await database.db.selectFrom('processing_jobs').select('status').execute();

                expect(jobs.map((job) => job.status)).toEqual(['complete', 'complete', 'complete']);
            },
            { timeout: 10_000 },
        );
    }, 30_000);
});

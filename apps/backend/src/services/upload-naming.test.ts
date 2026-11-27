import { createHash, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env', async () => ({ env: (await import('../testing/upload-env.js')).testEnv }));
vi.mock('../queues/ocr.queue', async () => (await import('../testing/upload-env.js')).ocrQueueStub);
vi.mock('../queues/thumbnail.queue', async () => (await import('../testing/upload-env.js')).thumbnailQueueStub);
vi.mock('../transcode/cleanup', () => ({ deleteTranscodeSetIfUnused: async () => {} }));

import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { countAdvisoryLockWaiters } from '../testing/advisory-locks.js';
import { dbProxy } from '../testing/db-proxy.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { storageRoot } from '../testing/upload-env.js';
import { getUploadService, type UploadedFile } from './upload.service';

describeDb('keep-both upload naming', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let folderId: string;

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        dbProxy.use(db);
        userId = await seedUser(db, 'owner');
        // The seeded storage path is absolute, which the storage provider refuses.
        await db.updateTable('users').set({ storage_quota_bytes: 100_000_000, storage_path: 'users/owner' }).where('id', '=', userId).execute();
    }, 60_000);
    afterAll(async () => {
        await database?.close();
        await rm(storageRoot, { recursive: true, force: true });
    });
    beforeEach(async () => {
        await db.deleteFrom('documents').execute();
        folderId = (await seedFolder(db, userId, randomUUID())).id;
    });

    async function toFile(filename: string): Promise<UploadedFile> {
        const content = randomUUID();
        const tempPath = join(storageRoot, content + '.upload');
        await writeFile(tempPath, content);

        return { tempPath, size: content.length, hash: createHash('sha256').update(content).digest('hex'), filename, mimetype: 'text/plain' };
    }

    /** `folder`: null uploads to the top level, left out to this test's folder. */
    async function upload(filenames: string[], folder: string | null = folderId): Promise<string[]> {
        const files = await Promise.all(filenames.map(toFile));
        const { documents } = await getUploadService().uploadFiles(files, userId, folder ?? undefined, undefined, 'keep_both');

        return documents.map((document) => document.original_filename);
    }

    const numbered = (name: string, count: number) => [name + '.txt', ...Array.from({ length: count - 1 }, (_, i) => `${name} (${i + 1}).txt`)];

    it('gives concurrent requests with the same name distinct names', async () => {
        const names = await Promise.all(Array.from({ length: 6 }, () => upload(['scan.txt'])));

        expect(names.flat().sort()).toEqual(numbered('scan', 6).sort());
    });

    it('gives concurrent same-name uploads at the top level distinct names', async () => {
        const names = await Promise.all(Array.from({ length: 4 }, () => upload(['top.txt'], null)));

        expect(names.flat().sort()).toEqual(numbered('top', 4).sort());
    });

    it('waits for a session that holds the folder, and numbers after what it added', async () => {
        let release = () => {};

        const released = new Promise<void>((resolve) => (release = resolve));

        let held = () => {};

        const isHeld = new Promise<void>((resolve) => (held = resolve));
        const other = db.transaction().execute(async (trx) => {
            await sql`SELECT pg_advisory_xact_lock(hashtext(${'upload-name:' + userId + ':' + folderId}))`.execute(trx);
            await seedDocument(trx, { userId, folderId, name: 'scan.txt' });
            held();
            await released;
        });
        await isHeld;

        const uploaded = upload(['scan.txt']);
        await vi.waitFor(async () => expect(await countAdvisoryLockWaiters(db)).toBe(1));
        release();

        expect(await uploaded).toEqual(['scan (1).txt']);
        await other;
    });

    it('gives the same-named files of one request distinct names', async () => {
        await seedDocument(db, { userId, folderId, name: 'scan.txt' });

        const names = await upload(['scan.txt', 'scan.txt', 'scan.txt']);

        expect(names.sort()).toEqual(['scan (1).txt', 'scan (2).txt', 'scan (3).txt']);
    });

    it('counts a name only where the upload goes, and not in the trash', async () => {
        const { id: other } = await seedFolder(db, userId, randomUUID());
        await seedDocument(db, { userId, folderId: other, name: 'scan.txt' });
        await seedDocument(db, { userId, folderId, name: 'scan.txt', deleted: true });
        await seedDocument(db, { userId, name: 'scan.txt' });

        expect(await upload(['scan.txt'])).toEqual(['scan.txt']);
    });

    it.each([
        ['100%.txt', '100% (2).txt'],
        ['a_b.txt', 'a_b (2).txt'],
        ['c:\\notes.txt', 'c:\\notes (2).txt'],
        ['.hidden', ' (2).hidden'],
        ['README', 'README (2)'],
        ['scan (1).txt', 'scan (1) (2).txt'],
    ])('numbers %s after the copies already there', async (name, expected) => {
        const first = expected.replace('(2)', '(1)');
        await seedDocument(db, { userId, folderId, name });
        await seedDocument(db, { userId, folderId, name: first });

        expect(await upload([name])).toEqual([expected]);
    });
});

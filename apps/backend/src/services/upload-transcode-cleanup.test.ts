import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

const storage = vi.hoisted(() => ({ files: new Map<string, string>(), deleted: [] as string[] }));

vi.mock('./storage.service', () => ({
    getStorageService: () => ({
        deleteFile: async (path: string) => {
            storage.deleted.push(path);
            storage.files.delete(path);
        },
        fileExists: async (path: string) => storage.files.has(path),
        writeFile: async (path: string) => void storage.files.set(path, 'x'),
    }),
}));

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { dbProxy } from '../testing/db-proxy.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { insertTranscodeSet, findTranscodeSet, toMasterPath } from '../transcode/repository';
import { getUploadService } from './upload.service';

/** Purging a video removes its HLS renditions only when it is the last document with that content. */
describeDb('purging a video removes its renditions with the last reference', () => {
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
    beforeEach(() => {
        storage.files.clear();
        storage.deleted.length = 0;
    });

    async function seedWithSet(hash: string, mime = 'video/mp4', name = `${hash}.mp4`) {
        const id = await seedDocument(db, { userId, name, mime, hash });
        const files = [`transcode/${hash}/v720/index.m3u8`, toMasterPath(hash)];

        for (const file of files) storage.files.set(file, 'x');

        await insertTranscodeSet(db, hash, { files, rungs: [], encoder: 'cpu', toneMap: null, totalBytes: 2 });

        return db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    }

    it('removes the set when the last document goes', async () => {
        const doc = await seedWithSet('last-one');

        await db.deleteFrom('documents').where('id', '=', doc.id).execute();
        await getUploadService().deleteDocumentFiles(doc, userId);

        expect(await findTranscodeSet(db, 'last-one')).toBeNull();
        expect(storage.deleted).toEqual(expect.arrayContaining(files('last-one')));
    });

    it('keeps the set while a duplicate upload still uses it', async () => {
        const doc = await seedWithSet('dup');

        await seedDocument(db, { userId, name: 'dup-copy.mp4', mime: 'video/mp4', hash: 'dup' });
        await db.deleteFrom('documents').where('id', '=', doc.id).execute();
        await getUploadService().deleteDocumentFiles(doc, userId);

        expect(await findTranscodeSet(db, 'dup')).not.toBeNull();
        expect(storage.files.has(toMasterPath('dup'))).toBe(true);
    });

    it('does not look for renditions of a document that is not a video', async () => {
        const doc = await seedWithSet('a-pdf', 'application/pdf', 'a.pdf');

        await db.deleteFrom('documents').where('id', '=', doc.id).execute();
        await getUploadService().deleteDocumentFiles(doc, userId);

        expect(await findTranscodeSet(db, 'a-pdf')).not.toBeNull();
    });

    function files(hash: string): string[] {
        return [`transcode/${hash}/v720/index.m3u8`, toMasterPath(hash)];
    }
});

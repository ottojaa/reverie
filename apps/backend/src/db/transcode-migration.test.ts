import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedDocument, seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/023_transcode';

describeDb('migration 023 (transcode)', () => {
    let database: TestDatabase;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    const exists = async (query: ReturnType<typeof sql<{ found: boolean }>>) => (await query.execute(database.db)).rows[0]!.found;
    const hasStatusColumn = () =>
        exists(
            sql<{
                found: boolean;
            }>`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'transcode_status') AS found`,
        );
    const hasSetsTable = () => exists(sql<{ found: boolean }>`SELECT to_regclass('transcode_sets') IS NOT NULL AS found`);

    it('adds the status column and the sets table; a document inserted without a status (older code) is skipped', async () => {
        const userId = await seedUser(database.db, 'owner');
        const id = await seedDocument(database.db, { userId, name: 'a.pdf' });

        expect(await hasStatusColumn()).toBe(true);
        expect(await hasSetsTable()).toBe(true);
        expect((await database.db.selectFrom('documents').select('transcode_status').where('id', '=', id).executeTakeFirstOrThrow()).transcode_status).toBe(
            'skipped',
        );
    });

    it('sets existing videos to pending and leaves every other document skipped, when it is applied to a populated database', async () => {
        const userId = await seedUser(database.db, 'second');
        const video = await seedDocument(database.db, { userId, name: 'b.mov', mime: 'video/quicktime' });
        const photo = await seedDocument(database.db, { userId, name: 'b.jpg', mime: 'image/jpeg' });

        await down(untyped());
        await up(untyped());

        const status = async (id: string) =>
            (await database.db.selectFrom('documents').select('transcode_status').where('id', '=', id).executeTakeFirstOrThrow()).transcode_status;

        expect(await status(video)).toBe('pending');
        expect(await status(photo)).toBe('skipped');
    });

    it('reverses completely, leaves the documents alone, and applies again', async () => {
        const userId = await seedUser(database.db, 'third');
        const id = await seedDocument(database.db, { userId, name: 'c.mp4', mime: 'video/mp4' });

        await down(untyped());
        expect(await hasStatusColumn()).toBe(false);
        expect(await hasSetsTable()).toBe(false);
        expect(await database.db.selectFrom('documents').select('id').where('id', '=', id).execute()).toHaveLength(1);

        await up(untyped());
        expect(await hasStatusColumn()).toBe(true);
        expect(await hasSetsTable()).toBe(true);
    });
});

import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedDocument, seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/020_camera_read_at';

describeDb('migration 020 (camera_read_at)', () => {
    let database: TestDatabase;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    const hasColumn = async () => {
        const result = await sql<{ found: boolean }>`
            SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'camera_read_at') AS found
        `.execute(database.db);

        return result.rows[0]!.found;
    };

    it('adds a nullable marker that no existing row has set', async () => {
        const userId = await seedUser(database.db, 'owner');
        const id = await seedDocument(database.db, { userId, name: 'a.jpg', mime: 'image/jpeg' });

        expect(await hasColumn()).toBe(true);
        expect((await database.db.selectFrom('documents').select('camera_read_at').where('id', '=', id).executeTakeFirstOrThrow()).camera_read_at).toBeNull();
    });

    it('reverses completely, keeps the rows, and applies again', async () => {
        const userId = await seedUser(database.db, 'second');
        const id = await seedDocument(database.db, { userId, name: 'b.jpg', mime: 'image/jpeg' });

        await down(untyped());
        expect(await hasColumn()).toBe(false);
        expect(await database.db.selectFrom('documents').select('id').where('id', '=', id).execute()).toHaveLength(1);

        await up(untyped());
        expect(await hasColumn()).toBe(true);
    });
});

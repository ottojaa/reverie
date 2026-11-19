import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { down, up } from '../db/migrations/013_tool_audit_log';
import { seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';

describeDb('migration 013 (tool_audit_log)', () => {
    let database: TestDatabase;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    async function tableExists(): Promise<boolean> {
        const { rows } = await sql<{ found: boolean }>`SELECT to_regclass('public.tool_audit_log') IS NOT NULL AS found`.execute(database.db);

        return rows[0]!.found;
    }

    it('creates the table with an index on user and time', async () => {
        const { rows } = await sql<{ indexname: string }>`SELECT indexname FROM pg_indexes WHERE tablename = 'tool_audit_log'`.execute(database.db);

        expect(await tableExists()).toBe(true);
        expect(rows.map((row) => row.indexname)).toContain('idx_tool_audit_log_user_created');
    });

    it('leaves library data alone when it is rolled back and applied again', async () => {
        const userId = await seedUser(database.db, 'migrator');

        await down(untyped());
        expect(await tableExists()).toBe(false);
        expect((await database.db.selectFrom('users').select('id').where('id', '=', userId).execute()).length).toBe(1);

        await up(untyped());
        expect(await tableExists()).toBe(true);
    });

    it('removes a user’s entries with the user', async () => {
        const userId = await seedUser(database.db, 'leaver');

        await database.db
            .insertInto('tool_audit_log')
            .values({ user_id: userId, tool: 'add_tags', input: '{}', state_before: '{}', state_after: '{}' })
            .execute();
        await database.db.deleteFrom('users').where('id', '=', userId).execute();
        expect(await database.db.selectFrom('tool_audit_log').select('id').where('user_id', '=', userId).execute()).toEqual([]);
    });
});

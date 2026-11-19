import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Migrator, sql, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/014_api_tokens';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

/** The real migration files, as the production migrator sees them. */
const provider: MigrationProvider = {
    async getMigrations() {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
        const entries = await Promise.all(
            files.map(async (file) => [file.replace(/\.ts$/, ''), (await import(join(MIGRATIONS_DIR, file))) as Migration] as const),
        );

        return Object.fromEntries(entries);
    },
};

describeDb('migration 014 (api_tokens)', () => {
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
        const { rows } = await sql<{ found: boolean }>`SELECT to_regclass('public.api_tokens') IS NOT NULL AS found`.execute(database.db);

        return rows[0]!.found;
    }

    function insertToken(userId: string, hash: string) {
        return database.db
            .insertInto('api_tokens')
            .values({ user_id: userId, name: 'laptop', token_hash: hash, token_prefix: 'rvr_abcd1234', expires_at: null });
    }

    it('creates the table with personal as the default kind and no expiry', async () => {
        const userId = await seedUser(database.db, 'owner');
        const row = await insertToken(userId, 'hash-1').returningAll().executeTakeFirstOrThrow();

        expect(await tableExists()).toBe(true);
        expect(row).toMatchObject({ kind: 'personal', expires_at: null, last_used_at: null, revoked_at: null });
    });

    it('refuses a second token with the same hash', async () => {
        const userId = await seedUser(database.db, 'duplicator');

        await insertToken(userId, 'hash-2').execute();
        await expect(insertToken(userId, 'hash-2').execute()).rejects.toThrow();
    });

    it('removes a user’s tokens with the user', async () => {
        const userId = await seedUser(database.db, 'leaver');

        await insertToken(userId, 'hash-3').execute();
        await database.db.deleteFrom('users').where('id', '=', userId).execute();
        expect(await database.db.selectFrom('api_tokens').select('id').where('user_id', '=', userId).execute()).toEqual([]);
    });

    it('rolls back and applies again without touching library data', async () => {
        const userId = await seedUser(database.db, 'migrator');

        await down(untyped());
        expect(await tableExists()).toBe(false);
        expect((await database.db.selectFrom('users').select('id').where('id', '=', userId).execute()).length).toBe(1);

        await up(untyped());
        expect(await tableExists()).toBe(true);
    });

    it('goes down and up through the migrator itself, which keeps its own bookkeeping', async () => {
        const migrator = new Migrator({ db: database.db, provider });
        const { rows } = await sql<{ name: string }>`SELECT name FROM kysely_migration WHERE name = '014_api_tokens'`.execute(database.db);

        expect(rows).toHaveLength(1);
        // Roll back to just before 014 (undoing any later migration on the way), then forward again.
        expect((await migrator.migrateTo('013_tool_audit_log')).error).toBeUndefined();
        expect(await tableExists()).toBe(false);
        expect((await migrator.migrateToLatest()).error).toBeUndefined();
        expect(await tableExists()).toBe(true);
    });
});

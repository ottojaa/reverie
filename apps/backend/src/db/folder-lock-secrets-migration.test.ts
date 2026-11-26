import { Migrator, sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, migrationProvider, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';

const BEFORE = '029_drop_folder_type';
const AFTER = '030_folder_lock_secrets';

describeDb('migration 030 (folder lock secrets)', () => {
    let database: TestDatabase;
    let migrator: Migrator;

    async function migrateTo(name: string): Promise<void> {
        const { error } = await migrator.migrateTo(name);

        if (error) throw error;
    }

    async function hasTable(): Promise<boolean> {
        const { rows } = await sql<{ found: boolean }>`SELECT to_regclass('folder_lock_secrets') IS NOT NULL AS found`.execute(database.db);

        return rows[0]!.found;
    }

    async function createUser(label: string): Promise<string> {
        const { rows } = await sql<{ id: string }>`
            INSERT INTO users (email, display_name, password_hash, storage_quota_bytes, storage_path)
            VALUES (${label + '@example.test'}, ${label}, 'x', 1, ${'/' + label}) RETURNING id
        `.execute(database.db);

        return rows[0]!.id;
    }

    /** Raw, so the values the types rule out can be tried too. */
    async function insert(userId: string, kind: string | null, secretHash: string | null): Promise<void> {
        await sql`INSERT INTO folder_lock_secrets (user_id, kind, secret_hash) VALUES (${userId}, ${kind}, ${secretHash})`.execute(database.db);
    }

    async function fetchRows(userId: string) {
        return database.db.selectFrom('folder_lock_secrets').selectAll().where('user_id', '=', userId).execute();
    }

    beforeAll(async () => {
        database = await createTestDatabase();
        migrator = new Migrator({ db: database.db as unknown as Kysely<unknown>, provider: migrationProvider });
        // The harness ran every migration; step back so that `up` runs here.
        await migrateTo(BEFORE);
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    it('creates the table, leaving existing users without a row', async () => {
        const userId = await createUser('mig030-existing');

        expect(await hasTable()).toBe(false);

        await migrateTo(AFTER);

        expect(await hasTable()).toBe(true);
        expect(await fetchRows(userId)).toEqual([]);
    });

    it('takes a PIN or a password', async () => {
        const pinUser = await createUser('mig030-pin');
        const passwordUser = await createUser('mig030-password');

        await insert(pinUser, 'pin', 'hash-a');
        await insert(passwordUser, 'password', 'hash-b');

        expect(await fetchRows(pinUser)).toMatchObject([{ kind: 'pin', secret_hash: 'hash-a' }]);
        expect(await fetchRows(passwordUser)).toMatchObject([{ kind: 'password', secret_hash: 'hash-b' }]);
    });

    it('takes a row without a secret, filling in the defaults', async () => {
        const userId = await createUser('mig030-empty');

        await database.db.insertInto('folder_lock_secrets').values({ user_id: userId, kind: null, secret_hash: null }).execute();

        expect(await fetchRows(userId)).toEqual([
            { user_id: userId, kind: null, secret_hash: null, wrong_tries: 0, generation: 0, updated_at: expect.any(Date) },
        ]);
    });

    it('refuses another kind, a kind without a hash and a hash without a kind', async () => {
        const userId = await createUser('mig030-refused');

        await expect(insert(userId, 'pattern', 'hash')).rejects.toMatchObject({ constraint: 'folder_lock_secrets_kind_check' });
        await expect(insert(userId, 'pin', null)).rejects.toMatchObject({ constraint: 'folder_lock_secrets_check' });
        await expect(insert(userId, null, 'hash')).rejects.toMatchObject({ constraint: 'folder_lock_secrets_check' });
        expect(await fetchRows(userId)).toEqual([]);
    });

    it('holds one row per user, and only for a user that exists', async () => {
        const userId = await createUser('mig030-once');

        await insert(userId, 'pin', 'hash');

        await expect(insert(userId, 'password', 'other')).rejects.toMatchObject({ constraint: 'folder_lock_secrets_pkey' });
        await expect(insert(crypto.randomUUID(), 'pin', 'hash')).rejects.toMatchObject({ constraint: 'folder_lock_secrets_user_id_fkey' });
    });

    it('removes the row with its user, and no other', async () => {
        const gone = await createUser('mig030-gone');
        const kept = await createUser('mig030-kept');

        await insert(gone, 'pin', 'hash');
        await insert(kept, 'pin', 'hash');
        await database.db.deleteFrom('users').where('id', '=', gone).execute();

        expect(await fetchRows(gone)).toEqual([]);
        expect(await fetchRows(kept)).toHaveLength(1);
    });

    it('goes down, dropping the table and keeping the users', async () => {
        const before = await database.db.selectFrom('users').selectAll().orderBy('id').execute();

        await migrateTo(BEFORE);

        expect(await hasTable()).toBe(false);
        expect(await database.db.selectFrom('users').selectAll().orderBy('id').execute()).toEqual(before);
    });

    it('goes up again, empty and usable', async () => {
        await migrateTo(AFTER);

        expect(await database.db.selectFrom('folder_lock_secrets').selectAll().execute()).toEqual([]);

        const userId = await createUser('mig030-again');

        await insert(userId, 'password', 'hash');

        expect(await fetchRows(userId)).toHaveLength(1);
    });
});

import { Migrator, sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, migrationProvider, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';

const BEFORE = '028_relax_folder_type';
const AFTER = '029_drop_folder_type';

describeDb('migration 029 (folder type dropped)', () => {
    let database: TestDatabase;
    let migrator: Migrator;
    let userId: string;
    const ids: Record<string, string> = {};

    /** Written without a type, as the servers on both sides of this migration write. */
    async function folder(name: string, parent?: string): Promise<void> {
        const { rows } = await sql<{ id: string }>`
            INSERT INTO folders (user_id, parent_id, name, path)
            VALUES (${userId}, ${parent ? ids[parent]! : null}, ${name}, ${'/' + name}) RETURNING id
        `.execute(database.db);

        ids[name] = rows[0]!.id;
    }

    async function fetchRows(): Promise<Record<string, unknown>[]> {
        const { rows } = await sql<Record<string, unknown>>`SELECT * FROM folders ORDER BY name`.execute(database.db);

        return rows;
    }

    async function fetchTypes(): Promise<Record<string, unknown>> {
        return Object.fromEntries((await fetchRows()).map((row) => [row['name'], row['type']]));
    }

    async function fetchColumn(): Promise<unknown> {
        const { rows } = await sql`
            SELECT data_type, character_maximum_length, is_nullable, column_default
            FROM information_schema.columns WHERE table_name = 'folders' AND column_name = 'type'
        `.execute(database.db);

        return rows[0];
    }

    async function migrateTo(name: string): Promise<void> {
        const { error } = await migrator.migrateTo(name);

        if (error) throw error;
    }

    const toUntyped = (rows: Record<string, unknown>[]) => rows.map(({ type: _type, ...rest }) => rest);
    /** Filling the column rewrites every row, which bumps `updated_at`. */
    const toUndated = (rows: Record<string, unknown>[]) => toUntyped(rows).map(({ updated_at: _updatedAt, ...rest }) => rest);

    const COLUMN = { data_type: 'character varying', character_maximum_length: 10, is_nullable: 'YES', column_default: null };
    const IMPLIED = { top: 'collection', middle: 'folder', bottom: 'folder', alone: 'collection' };

    beforeAll(async () => {
        database = await createTestDatabase();
        migrator = new Migrator({ db: database.db as unknown as Kysely<unknown>, provider: migrationProvider });
        await migrateTo(BEFORE);

        const { rows } = await sql<{ id: string }>`
            INSERT INTO users (email, display_name, password_hash, storage_quota_bytes, storage_path)
            VALUES ('mig029@example.test', 'mig', 'x', 1, '/mig029') RETURNING id
        `.execute(database.db);

        userId = rows[0]!.id;
        await folder('top');
        await folder('middle', 'top');
        await folder('bottom', 'middle');
        await folder('alone');
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    it('drops the column and nothing else', async () => {
        const before = await fetchRows();

        expect(await fetchColumn()).toEqual(COLUMN);

        await migrateTo(AFTER);

        expect(await fetchColumn()).toBeUndefined();
        expect(await fetchRows()).toEqual(toUntyped(before));
    });

    it('goes down, giving every folder the type its place implies', async () => {
        const before = await fetchRows();

        await migrateTo(BEFORE);

        expect(await fetchColumn()).toEqual(COLUMN);
        expect(await fetchTypes()).toEqual(IMPLIED);
        expect(toUndated(await fetchRows())).toEqual(toUndated(before));
    });

    it('goes up again, still taking new folders', async () => {
        await migrateTo(AFTER);

        expect(await fetchColumn()).toBeUndefined();
        await folder('after', 'bottom');
        expect(await fetchRows()).toHaveLength(5);
    });
});

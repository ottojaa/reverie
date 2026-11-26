import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Migrator, sql, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const BEFORE = '027_nested_folders';
const AFTER = '028_relax_folder_type';

const provider: MigrationProvider = {
    async getMigrations() {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
        const entries = await Promise.all(
            files.map(async (file) => [file.replace(/\.ts$/, ''), (await import(join(MIGRATIONS_DIR, file))) as Migration] as const),
        );

        return Object.fromEntries(entries);
    },
};

interface SeedFolder {
    parent?: string;
    /** Left out, the insert does not mention the column, as a server that no longer knows it writes. */
    type?: 'collection' | 'folder';
    isPrivate?: boolean;
}

/** Migration 028 under both servers that can meet it: one that writes `folders.type` and one that does not. */
describeDb('migration 028 (folder type no longer required)', () => {
    let database: TestDatabase;
    let migrator: Migrator;
    let userId: string;
    const ids: Record<string, string> = {};

    async function folder(name: string, seed: SeedFolder = {}): Promise<void> {
        const parentId = seed.parent ? ids[seed.parent]! : null;
        const column = seed.type ? sql`, type` : sql``;
        const value = seed.type ? sql`, ${seed.type}` : sql``;
        const { rows } = await sql<{ id: string }>`
            INSERT INTO folders (user_id, parent_id, name, path, is_private${column})
            VALUES (${userId}, ${parentId}, ${name}, ${'/' + name}, ${seed.isPrivate ?? false}${value}) RETURNING id
        `.execute(database.db);

        ids[name] = rows[0]!.id;
    }

    async function fetchTypes(): Promise<Record<string, string | null>> {
        const { rows } = await sql<{ name: string; type: string | null }>`SELECT name, type FROM folders`.execute(database.db);

        return Object.fromEntries(rows.map((row) => [row.name, row.type]));
    }

    async function fetchColumn(): Promise<{ is_nullable: string; column_default: string | null }> {
        const { rows } = await sql<{ is_nullable: string; column_default: string | null }>`
            SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'folders' AND column_name = 'type'
        `.execute(database.db);

        return rows[0]!;
    }

    async function migrateTo(name: string): Promise<void> {
        const { error } = await migrator.migrateTo(name);

        if (error) throw error;
    }

    const RELAXED = { is_nullable: 'YES', column_default: null };
    const REQUIRED = { is_nullable: 'NO', column_default: "'section'::character varying" };

    beforeAll(async () => {
        database = await createTestDatabase();
        migrator = new Migrator({ db: database.db as unknown as Kysely<unknown>, provider });
        await migrateTo(BEFORE);

        const { rows } = await sql<{ id: string }>`
            INSERT INTO users (email, display_name, password_hash, storage_quota_bytes, storage_path)
            VALUES ('mig028@example.test', 'mig', 'x', 1, '/mig028') RETURNING id
        `.execute(database.db);

        userId = rows[0]!.id;
        await folder('top', { type: 'collection' });
        await folder('middle', { parent: 'top', type: 'folder', isPrivate: true });
        await folder('bottom', { parent: 'middle', type: 'folder' });
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    it('takes a folder written without a type before it runs', async () => {
        expect(await fetchColumn()).toEqual(REQUIRED);
        await folder('early', { parent: 'bottom' });
        expect((await fetchTypes())['early']).toBe('section');
    });

    it('drops the requirement and the default, leaving the rows as they are', async () => {
        const before = await fetchTypes();

        await migrateTo(AFTER);

        expect(await fetchColumn()).toEqual(RELAXED);
        expect(await fetchTypes()).toEqual(before);
    });

    it('still takes the creates and moves of a server that writes the type', async () => {
        await folder('old top', { type: 'collection' });
        await folder('old nested', { parent: 'middle', type: 'folder' });
        await sql`UPDATE folders SET parent_id = NULL, path = '/bottom', type = 'collection' WHERE id = ${ids['bottom']!}`.execute(database.db);
        await sql`UPDATE folders SET parent_id = ${ids['top']!}, path = '/top/old top', type = 'folder' WHERE id = ${ids['old top']!}`.execute(database.db);

        expect(await fetchTypes()).toMatchObject({ bottom: 'collection', 'old top': 'folder', 'old nested': 'folder' });
    });

    it('goes down, giving every folder the type its place implies, and up again', async () => {
        await folder('new top');
        await folder('new nested', { parent: 'new top' });
        expect((await fetchTypes())['new top']).toBeNull();

        await migrateTo(BEFORE);

        expect(await fetchColumn()).toEqual(REQUIRED);
        expect(await fetchTypes()).toEqual({
            top: 'collection',
            middle: 'folder',
            bottom: 'collection',
            early: 'folder',
            'old top': 'folder',
            'old nested': 'folder',
            'new top': 'collection',
            'new nested': 'folder',
        });

        await migrateTo(AFTER);

        expect(await fetchColumn()).toEqual(RELAXED);
        await folder('after', { parent: 'middle' });
        expect((await fetchTypes())['after']).toBeNull();
    });
});

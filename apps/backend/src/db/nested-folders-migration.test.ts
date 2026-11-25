import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Migrator, sql, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const BEFORE = '026_favourites';

const provider: MigrationProvider = {
    async getMigrations() {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
        const entries = await Promise.all(
            files.map(async (file) => [file.replace(/\.ts$/, ''), (await import(join(MIGRATIONS_DIR, file))) as Migration] as const),
        );

        return Object.fromEntries(entries);
    },
};

interface FolderRow {
    id: string;
    parent_id: string | null;
    name: string;
    path: string;
    type: string;
    is_private: boolean;
    deleted: boolean;
}

interface SeedFolder {
    parent?: string | undefined;
    path?: string;
    type?: 'collection' | 'folder';
    isPrivate?: boolean;
    trashed?: boolean;
    created?: number;
}

/** Migration 027 on a database holding every kind of row the two-level rules let through, written with raw SQL. */
describeDb('migration 027 (nested folders)', () => {
    let database: TestDatabase;
    let migrator: Migrator;
    let userId: string;
    const logged: string[] = [];
    const ids: Record<string, string> = {};
    let foldersBefore: FolderRow[];
    let placementBefore: unknown[];

    async function folder(key: string, name: string, seed: SeedFolder = {}): Promise<void> {
        const { rows } = await sql<{ id: string }>`
            INSERT INTO folders (user_id, parent_id, name, path, type, is_private, sort_order, deleted_at, created_at)
            VALUES (${userId}, ${seed.parent ? ids[seed.parent]! : null}, ${name}, ${seed.path ?? '/' + key},
                    ${seed.type ?? (seed.parent ? 'folder' : 'collection')}, ${seed.isPrivate ?? false}, 0,
                    ${seed.trashed ? sql`now()` : null}, ${new Date(Date.UTC(2026, 0, 1, 0, seed.created ?? 0))})
            RETURNING id
        `.execute(database.db);

        ids[key] = rows[0]!.id;
    }

    async function document(name: string, folderKey: string | null): Promise<void> {
        await sql`
            INSERT INTO documents (user_id, folder_id, file_path, file_hash, original_filename, mime_type, size_bytes)
            VALUES (${userId}, ${folderKey ? ids[folderKey]! : null}, ${'/f/' + name}, ${name}, ${name}, 'application/pdf', 1)
        `.execute(database.db);
    }

    async function fetchFolders(): Promise<FolderRow[]> {
        const { rows } = await sql<FolderRow>`
            SELECT id, parent_id, name, path, type, is_private, deleted_at IS NOT NULL AS deleted FROM folders ORDER BY id
        `.execute(database.db);

        return rows;
    }

    const fetchPlacement = async () => (await sql`SELECT id, folder_id FROM documents ORDER BY id`.execute(database.db)).rows;
    const find = (rows: FolderRow[], key: string) => rows.find((row) => row.id === ids[key])!;

    async function fetchPathIndexes(): Promise<Record<string, string>> {
        const { rows } = await sql<{ indexname: string; indexdef: string }>`
            SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'folders' AND indexname IN ('idx_folders_user_path', 'idx_folders_sibling_name')
        `.execute(database.db);

        return Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    }

    async function seed(): Promise<void> {
        await folder('work', 'Work', { path: '/Work' });
        await folder('stale', 'Reports', { parent: 'work', path: '/OldName/Reports' });
        await folder('slash', 'a/b', { parent: 'work', path: '/Work/a/b', created: 2 });
        await folder('dash', 'a-b', { parent: 'work', path: '/Work/a-b', created: 1 });
        await folder('upper', 'Taxes', { parent: 'work', path: '/Work/Taxes', created: 1 });
        await folder('lower', 'taxes', { parent: 'work', path: '/Work/taxes', created: 2 });
        await folder('lowerTwo', 'TAXES (2)', { parent: 'work', path: '/Work/TAXES (2)', created: 3 });
        await folder('underClash', 'Q1', { parent: 'lower', path: '/Work/taxes/Q1' });
        await folder('loose', 'Loose', { type: 'folder', path: '/Loose' });
        await folder('vault', 'Vault', { isPrivate: true, path: '/Vault' });
        await folder('inner', 'Inner', { parent: 'vault', path: '/Vault/Inner', isPrivate: true });
        await folder('gone', 'Gone', { trashed: true, path: '/Gone' });
        await folder('orphan', 'Kept', { parent: 'gone', path: '/Gone/Kept' });
        await folder('reborn', 'Gone', { path: '/Gone', created: 4 });
        await folder('trashedTwin', 'work', { trashed: true, path: '/work' });
        await document('in-collection.pdf', 'work');
        await document('in-folder.pdf', 'stale');
        await document('top.pdf', null);
    }

    beforeAll(async () => {
        database = await createTestDatabase();
        migrator = new Migrator({ db: database.db as unknown as Kysely<unknown>, provider });
        await migrator.migrateTo(BEFORE);

        const { rows } = await sql<{ id: string }>`
            INSERT INTO users (email, display_name, password_hash, storage_quota_bytes, storage_path)
            VALUES ('mig027@example.test', 'mig', 'x', 1, '/mig027') RETURNING id
        `.execute(database.db);

        userId = rows[0]!.id;
        await seed();
        foldersBefore = await fetchFolders();
        placementBefore = await fetchPlacement();

        const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line));
        const { error } = await migrator.migrateToLatest();

        log.mockRestore();

        if (error) throw error;
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    it('logs how many rows of each odd kind there were', () => {
        expect(logged.filter((line) => line.startsWith('027 audit'))).toEqual([
            '027 audit, documents directly in a collection: 1',
            '027 audit, documents at the top level: 1',
            "027 audit, top-level folders of type 'folder': 1",
            "027 audit, folder names containing '/': 1",
            '027 audit, live siblings with the same name regardless of case: 1',
            '027 audit, folders with a stale path: 1',
            '027 audit, private folders beneath a private folder: 1',
            '027 audit, live folders under a trashed parent: 1',
            '027 audit, folders that are their own parent: 0',
        ]);
    });

    it("turns '/' into '-' and numbers the younger of two clashing siblings, skipping names already taken", async () => {
        const rows = await fetchFolders();

        expect(find(rows, 'dash').name).toBe('a-b');
        expect(find(rows, 'slash').name).toBe('a-b (2)');
        expect(find(rows, 'upper').name).toBe('Taxes');
        expect(find(rows, 'lower').name).toBe('taxes (3)');
        expect(find(rows, 'lowerTwo').name).toBe('TAXES (2)');
        expect(find(rows, 'trashedTwin').name).toBe('work');
    });

    it('rebuilds every path from the parents, children of renamed folders included', async () => {
        const rows = await fetchFolders();

        expect(find(rows, 'stale').path).toBe('/Work/Reports');
        expect(find(rows, 'slash').path).toBe('/Work/a-b (2)');
        expect(find(rows, 'underClash').path).toBe('/Work/taxes (3)/Q1');
        expect(find(rows, 'orphan').path).toBe('/Gone/Kept');
    });

    it('moves nothing and changes no privacy, and derives type from the parent', async () => {
        const rows = await fetchFolders();
        const placement = (all: FolderRow[]) => all.map(({ id, parent_id, is_private, deleted }) => ({ id, parent_id, is_private, deleted }));

        expect(placement(rows)).toEqual(placement(foldersBefore));
        expect(await fetchPlacement()).toEqual(placementBefore);

        for (const row of rows) expect(row.type).toBe(row.parent_id === null ? 'collection' : 'folder');
    });

    it('refuses a live sibling name in any case, at the top too, and a folder as its own parent', async () => {
        await expect(folder('clashTop', 'WORK', { path: '/WORK' })).rejects.toThrow(/idx_folders_sibling_name/);
        await expect(folder('clashChild', 'REPORTS', { parent: 'work', path: '/Work/REPORTS' })).rejects.toThrow(/idx_folders_sibling_name/);
        await expect(sql`UPDATE folders SET parent_id = id WHERE id = ${ids['work']!}`.execute(database.db)).rejects.toThrow(/folders_not_own_parent/);
        await folder('cousin', 'Reports', { parent: 'vault', path: '/Vault/Reports' });
    });

    it('goes down to a unique path index and up again', async () => {
        expect((await migrator.migrateTo(BEFORE)).error).toBeUndefined();

        const down = await fetchPathIndexes();

        expect(down['idx_folders_user_path']).toMatch(/^CREATE UNIQUE INDEX/);
        expect(down['idx_folders_sibling_name']).toBeUndefined();

        expect((await migrator.migrateToLatest()).error).toBeUndefined();

        const up = await fetchPathIndexes();

        expect(up['idx_folders_user_path']).toMatch(/^CREATE INDEX/);
        expect(up['idx_folders_sibling_name']).toMatch(/^CREATE UNIQUE INDEX/);
    });

    it('goes down to a plain path index when a live folder under a trashed one repeats a path', async () => {
        await folder('rebornChild', 'Kept', { parent: 'reborn', path: '/Gone/Kept' });

        const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line));
        const { error } = await migrator.migrateTo(BEFORE);

        log.mockRestore();

        expect(error).toBeUndefined();
        expect((await fetchPathIndexes())['idx_folders_user_path']).toMatch(/^CREATE INDEX/);
        expect(logged).toContain('027 down: live folder paths repeat, so idx_folders_user_path is not unique');
        expect((await migrator.migrateToLatest()).error).toBeUndefined();
    });
});

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Migrator, sql, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

const provider: MigrationProvider = {
    async getMigrations() {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
        const entries = await Promise.all(
            files.map(async (file) => [file.replace(/\.ts$/, ''), (await import(join(MIGRATIONS_DIR, file))) as Migration] as const),
        );

        return Object.fromEntries(entries);
    },
};

/**
 * Migration 016 drops `documents.is_private`. This test builds the database as it was just before
 * (everything up to 015), seeds flagged documents with raw SQL, then runs 016 for real.
 */
describeDb('migration 016 (folder locks)', () => {
    let database: TestDatabase;
    let migrator: Migrator;
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
        migrator = new Migrator({ db: untyped(), provider });
        // The harness ran every migration; step back to the state just before 016.
        await migrator.migrateTo('015_agent_chats').catch(() => undefined);
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    async function hasColumn(): Promise<boolean> {
        const { rows } = await sql<{ n: string }>`
            SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'is_private'
        `.execute(database.db);

        return Number(rows[0]!.n) > 0;
    }

    async function user(label: string): Promise<string> {
        const { rows } = await sql<{ id: string }>`
            INSERT INTO users (email, display_name, password_hash, storage_quota_bytes, storage_path)
            VALUES (${label + '@example.test'}, ${label}, 'x', 1, ${'/' + label}) RETURNING id
        `.execute(database.db);

        return rows[0]!.id;
    }

    async function folder(
        userId: string,
        name: string,
        kind: 'collection' | 'folder',
        isPrivate: boolean,
        parentId: string | null = null,
        parentPath = '',
    ): Promise<string> {
        const { rows } = await sql<{ id: string }>`
            INSERT INTO folders (user_id, parent_id, name, path, type, is_private, sort_order)
            VALUES (${userId}, ${parentId}, ${name}, ${parentPath + '/' + name}, ${kind}, ${isPrivate}, 0) RETURNING id
        `.execute(database.db);

        return rows[0]!.id;
    }

    async function document(userId: string, name: string, folderId: string | null, isPrivate: boolean, trashed = false): Promise<string> {
        const { rows } = await sql<{ id: string }>`
            INSERT INTO documents (user_id, folder_id, file_path, file_hash, original_filename, mime_type, size_bytes, is_private, deleted_at)
            VALUES (${userId}, ${folderId}, ${'/f/' + name}, ${crypto.randomUUID()}, ${name}, 'application/pdf', 1, ${isPrivate}, ${trashed ? sql`now()` : null})
            RETURNING id
        `.execute(database.db);

        return rows[0]!.id;
    }

    const folderOf = async (id: string) =>
        (
            await sql<{ folder_id: string | null; name: string | null; is_private: boolean | null }>`
            SELECT d.folder_id, f.name, f.is_private FROM documents d LEFT JOIN folders f ON f.id = d.folder_id WHERE d.id = ${id}
        `.execute(database.db)
        ).rows[0]!;

    it('is at the state before 016 with the column still there', async () => {
        expect(await hasColumn()).toBe(true);
    });

    it('moves loose flagged documents into a private "Private" folder per user, and leaves the rest alone', async () => {
        const alice = await user('mig-alice');
        const bob = await user('mig-bob');
        const publicCollection = await folder(alice, 'Work', 'collection', false);
        const publicFolder = await folder(alice, 'Docs', 'folder', false, publicCollection, '/Work');
        const privateCollection = await folder(alice, 'Vault', 'collection', true);
        const insidePrivate = await folder(alice, 'Inner', 'folder', false, privateCollection, '/Vault');
        const rootDoc = await document(alice, 'root.pdf', null, true);
        const publicFolderDoc = await document(alice, 'in-public.pdf', publicFolder, true);
        const trashedDoc = await document(alice, 'trashed.pdf', null, true, true);
        const alreadySafe = await document(alice, 'already-private.pdf', insidePrivate, true);
        const unflagged = await document(alice, 'plain.pdf', publicFolder, false);
        const bobsRoot = await document(bob, 'bob-root.pdf', null, true);

        await migrator.migrateToLatest();

        expect(await hasColumn()).toBe(false);

        for (const id of [rootDoc, publicFolderDoc, trashedDoc]) {
            const moved = await folderOf(id);
            const parent = (
                await sql<{ name: string; is_private: boolean }>`
                SELECT p.name, p.is_private FROM folders f JOIN folders p ON p.id = f.parent_id WHERE f.id = ${moved.folder_id}
            `.execute(database.db)
            ).rows[0];

            expect(moved.name).toBe('Private');
            expect(parent).toEqual({ name: 'Private', is_private: true });
        }

        expect((await folderOf(alreadySafe)).folder_id).toBe(insidePrivate);
        expect((await folderOf(unflagged)).folder_id).toBe(publicFolder);
        expect((await folderOf(bobsRoot)).name).toBe('Private');
        expect((await folderOf(bobsRoot)).folder_id).not.toBe((await folderOf(rootDoc)).folder_id);
    });

    it('does nothing but drop the column when no document is flagged (production today)', async () => {
        await migrator.migrateTo('015_agent_chats');
        expect(await hasColumn()).toBe(true);

        const before = Number((await sql<{ n: string }>`SELECT count(*) AS n FROM folders`.execute(database.db)).rows[0]!.n);

        await sql`UPDATE documents SET is_private = false`.execute(database.db);
        await migrator.migrateToLatest();

        expect(await hasColumn()).toBe(false);
        expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM folders`.execute(database.db)).rows[0]!.n)).toBe(before);
    });

    it('picks a free name when the user already has a "Private" collection', async () => {
        await migrator.migrateTo('015_agent_chats');

        const carol = await user('mig-carol');

        await folder(carol, 'Private', 'collection', false);

        const doc = await document(carol, 'c.pdf', null, true);

        await migrator.migrateToLatest();

        const parent = (
            await sql<{ name: string }>`
            SELECT p.name FROM documents d JOIN folders f ON f.id = d.folder_id JOIN folders p ON p.id = f.parent_id WHERE d.id = ${doc}
        `.execute(database.db)
        ).rows[0];

        expect(parent?.name).toBe('Private (2)');
    });

    it('goes down and up again: the column returns empty, moved documents stay private in their folder', async () => {
        const dave = await user('mig-dave');

        await migrator.migrateTo('015_agent_chats');

        const doc = await document(dave, 'd.pdf', null, true);

        await migrator.migrateToLatest();

        const placed = (await folderOf(doc)).folder_id;

        await migrator.migrateTo('015_agent_chats');

        expect(await hasColumn()).toBe(true);
        expect((await sql<{ is_private: boolean }>`SELECT is_private FROM documents WHERE id = ${doc}`.execute(database.db)).rows[0]!.is_private).toBe(false);
        expect((await folderOf(doc)).folder_id).toBe(placed);
        expect((await folderOf(doc)).is_private).toBe(false);

        await migrator.migrateToLatest();

        expect(await hasColumn()).toBe(false);
        expect((await folderOf(doc)).folder_id).toBe(placed);
    });
});

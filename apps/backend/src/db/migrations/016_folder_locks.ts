import { Kysely, sql } from 'kysely';

/**
 * Privacy now belongs to folders only: a document is private exactly when its folder (or its
 * collection) is, and there is no per-document flag any more.
 *
 * up():
 *  1. Every document whose own `is_private` flag is set but whose folder is not effectively private
 *     (a root document, a public folder, trashed documents included) is moved into a private folder
 *     named "Private", one per user, inside a private collection of the same name (documents live in
 *     folders, folders live in collections). The name gets " (2)", " (3)", ... when the user already
 *     has a live collection called that. A document that was private stays private, and now lives
 *     where its lock is.
 *  2. `documents.is_private` and its partial index are dropped.
 *
 * Deploy order: the new code is started first and this migration runs after, so the new code never
 * reads `documents.is_private`, and for a short window a flagged loose document reads as public.
 * With no flagged documents (as in production at the time of writing) this migration only drops the column.
 *
 * down(): re-adds `documents.is_private boolean not null default false` and its index. Documents
 * moved into "Private" stay there (still private through their folder); the flag is not restored,
 * because nothing says which documents carried it.
 */

const BASE_NAME = 'Private';

interface Stray {
    user_id: string;
}

export async function up(db: Kysely<unknown>): Promise<void> {
    const users = await sql<Stray>`
        SELECT DISTINCT d.user_id
        FROM documents d
        LEFT JOIN folders f ON f.id = d.folder_id
        LEFT JOIN folders p ON p.id = f.parent_id
        WHERE d.is_private
          AND NOT (COALESCE(f.is_private, false) OR COALESCE(p.is_private, false))
    `.execute(db);

    for (const { user_id } of users.rows) await movePrivateDocumentsIntoFolder(db, user_id);

    await sql`DROP INDEX IF EXISTS idx_documents_private`.execute(db);
    await db.schema.alterTable('documents').dropColumn('is_private').execute();
}

async function movePrivateDocumentsIntoFolder(db: Kysely<unknown>, userId: string): Promise<void> {
    const name = await pickFreeName(db, userId);
    const collection = await sql<{ id: string }>`
        INSERT INTO folders (user_id, parent_id, name, path, type, is_private, sort_order)
        VALUES (${userId}, NULL, ${name}, ${'/' + name}, 'collection', true, 0)
        RETURNING id
    `.execute(db);
    const folder = await sql<{ id: string }>`
        INSERT INTO folders (user_id, parent_id, name, path, type, is_private, sort_order)
        VALUES (${userId}, ${collection.rows[0]!.id}, ${name}, ${'/' + name + '/' + name}, 'folder', false, 0)
        RETURNING id
    `.execute(db);

    await sql`
        UPDATE documents d
        SET folder_id = ${folder.rows[0]!.id}
        WHERE d.user_id = ${userId}
          AND d.is_private
          AND NOT EXISTS (
              SELECT 1
              FROM folders f
              LEFT JOIN folders p ON p.id = f.parent_id
              WHERE f.id = d.folder_id AND (f.is_private OR COALESCE(p.is_private, false))
          )
    `.execute(db);
}

/** "Private", or "Private (2)", ... for the first name no live collection of the user has. */
async function pickFreeName(db: Kysely<unknown>, userId: string): Promise<string> {
    const taken = await sql<{ path: string }>`SELECT path FROM folders WHERE user_id = ${userId} AND deleted_at IS NULL AND parent_id IS NULL`.execute(db);
    const paths = new Set(taken.rows.map((row) => row.path));

    for (let suffix = 1; ; suffix++) {
        const name = suffix === 1 ? BASE_NAME : `${BASE_NAME} (${suffix})`;

        if (!paths.has('/' + name)) return name;
    }
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('documents')
        .addColumn('is_private', 'boolean', (col) => col.notNull().defaultTo(false))
        .execute();
    await sql`CREATE INDEX idx_documents_private ON documents (user_id) WHERE is_private`.execute(db);
}

import { Kysely, sql } from 'kysely';

/**
 * Favourites: the documents and folders a user has starred.
 *
 * up(): creates `favourites`, one row per starred item, pointing at exactly one document or one folder. Purging
 * the item (or deleting the user) removes the row through the foreign key; trashing it leaves the row, so a
 * restore brings the star back. No existing table changes, so code that predates this migration is unaffected.
 *
 * down(): drops the table, and with it every star. Nothing else is touched.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    // NULLs are distinct in a unique constraint, so each constraint only binds rows of its own kind.
    await sql`
        CREATE TABLE favourites (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
            folder_id uuid REFERENCES folders(id) ON DELETE CASCADE,
            starred_at timestamptz NOT NULL DEFAULT now(),
            CHECK (num_nonnulls(document_id, folder_id) = 1),
            UNIQUE (user_id, document_id),
            UNIQUE (user_id, folder_id)
        )
    `.execute(db);
    // For the cascades: a purge looks the item up without knowing the user.
    await sql`CREATE INDEX favourites_document_id_idx ON favourites (document_id)`.execute(db);
    await sql`CREATE INDEX favourites_folder_id_idx ON favourites (folder_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS favourites`.execute(db);
}

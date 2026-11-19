import { Kysely, sql } from 'kysely';

/**
 * Trash: deleting a document or folder sets `deleted_at` instead of removing the row.
 *
 * - documents.deleted_at / folders.deleted_at: when the item went to the trash (NULL = live).
 * - Partial indexes keep "what is in the trash" and the retention purge scan cheap; the trash is
 *   a small fraction of rows.
 * - The unique folder path index becomes partial (live folders only), so a trashed "Taxes" does not
 *   block creating a new one.
 *
 * Purely additive for running code: no trashed rows exist until the new code deploys, and old code
 * that never sets `deleted_at` behaves exactly as before.
 *
 * down(): trashed folders are deleted (a folder is only a name; its documents are already at the
 * root) because their paths may collide once the full unique index returns. Trashed documents are
 * not destroyed: dropping the column makes them live documents again.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE documents ADD COLUMN deleted_at timestamptz`.execute(db);
    await sql`ALTER TABLE folders ADD COLUMN deleted_at timestamptz`.execute(db);

    await sql`CREATE INDEX idx_documents_trashed ON documents (user_id, deleted_at) WHERE deleted_at IS NOT NULL`.execute(db);
    await sql`CREATE INDEX idx_folders_trashed ON folders (user_id, deleted_at) WHERE deleted_at IS NOT NULL`.execute(db);

    await sql`DROP INDEX idx_folders_user_path`.execute(db);
    await sql`CREATE UNIQUE INDEX idx_folders_user_path ON folders (user_id, path) WHERE deleted_at IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DELETE FROM folders WHERE deleted_at IS NOT NULL`.execute(db);

    await sql`DROP INDEX idx_folders_user_path`.execute(db);
    await sql`CREATE UNIQUE INDEX idx_folders_user_path ON folders (user_id, path)`.execute(db);

    await sql`DROP INDEX idx_folders_trashed`.execute(db);
    await sql`DROP INDEX idx_documents_trashed`.execute(db);

    await sql`ALTER TABLE folders DROP COLUMN deleted_at`.execute(db);
    await sql`ALTER TABLE documents DROP COLUMN deleted_at`.execute(db);
}

import { Kysely, sql } from 'kysely';

/**
 * Privacy / hidden items.
 *
 * - folders.is_private / documents.is_private: explicitly-set privacy flags.
 *   Effective privacy cascades at query time (a private collection makes its
 *   folders private, a private folder makes its documents private) — no
 *   denormalization, see folder.service.getPrivateFolderIds.
 * - users.hide_private: whether private items are hidden from the sidebar/browse
 *   until the vault is unlocked.
 *
 * Partial indexes keep the "which folders/documents are private" lookups cheap
 * (the private set is typically a small fraction of rows).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('folders')
        .addColumn('is_private', 'boolean', (col) => col.notNull().defaultTo(false))
        .execute();

    await db.schema
        .alterTable('documents')
        .addColumn('is_private', 'boolean', (col) => col.notNull().defaultTo(false))
        .execute();

    await db.schema
        .alterTable('users')
        .addColumn('hide_private', 'boolean', (col) => col.notNull().defaultTo(false))
        .execute();

    await sql`CREATE INDEX idx_folders_private ON folders (user_id) WHERE is_private`.execute(db);
    await sql`CREATE INDEX idx_documents_private ON documents (user_id) WHERE is_private`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex('idx_documents_private').ifExists().execute();
    await db.schema.dropIndex('idx_folders_private').ifExists().execute();
    await db.schema.alterTable('users').dropColumn('hide_private').execute();
    await db.schema.alterTable('documents').dropColumn('is_private').execute();
    await db.schema.alterTable('folders').dropColumn('is_private').execute();
}

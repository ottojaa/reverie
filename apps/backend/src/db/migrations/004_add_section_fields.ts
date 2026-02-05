import { Kysely, sql } from 'kysely';

/**
 * Migration 004: Section fields for folders
 *
 * Adds emoji and sort_order to support reorganisable sections (Notion-like).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('folders')
        .addColumn('emoji', 'varchar(8)')
        .execute();

    await db.schema
        .alterTable('folders')
        .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
        .execute();

    await sql`CREATE INDEX IF NOT EXISTS idx_folders_sort_order ON folders(user_id, parent_id, sort_order)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_folders_sort_order`.execute(db);
    await db.schema.alterTable('folders').dropColumn('sort_order').execute();
    await db.schema.alterTable('folders').dropColumn('emoji').execute();
}

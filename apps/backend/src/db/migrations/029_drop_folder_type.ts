import { sql, type Kysely } from 'kysely';

/**
 * Drops `folders.type`: where a folder sits follows from `parent_id`, and the server this deploy replaces neither
 * reads nor writes the column.
 *
 * down(): adds it back, nullable as 028 left it, holding what each folder's place implies ('collection' at the top
 * level, else 'folder').
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE folders DROP COLUMN type`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE folders ADD COLUMN type varchar(10)`.execute(db);
    await sql`UPDATE folders SET type = CASE WHEN parent_id IS NULL THEN 'collection' ELSE 'folder' END`.execute(db);
}

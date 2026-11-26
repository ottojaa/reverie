import { sql, type Kysely } from 'kysely';

/**
 * Nothing needs `folders.type` any more: where a folder sits follows from `parent_id`. The column is kept for one
 * more release, nullable and without a default, because the server this deploy replaces still writes it on every
 * folder it creates or moves. A later migration can drop it.
 *
 * down(): derives `type` from `parent_id` ('collection' at the top level, else 'folder') and restores the NOT NULL
 * and the default the column had.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE folders ALTER COLUMN type DROP NOT NULL, ALTER COLUMN type DROP DEFAULT`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`
        UPDATE folders SET type = CASE WHEN parent_id IS NULL THEN 'collection' ELSE 'folder' END
        WHERE type IS DISTINCT FROM CASE WHEN parent_id IS NULL THEN 'collection' ELSE 'folder' END
    `.execute(db);
    await sql`ALTER TABLE folders ALTER COLUMN type SET DEFAULT 'section', ALTER COLUMN type SET NOT NULL`.execute(db);
}

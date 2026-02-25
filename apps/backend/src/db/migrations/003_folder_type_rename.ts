import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`UPDATE folders SET type = 'collection' WHERE type = 'category'`.execute(db);
    await sql`UPDATE folders SET type = 'folder' WHERE type = 'section'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`UPDATE folders SET type = 'category' WHERE type = 'collection'`.execute(db);
    await sql`UPDATE folders SET type = 'section' WHERE type = 'folder'`.execute(db);
}

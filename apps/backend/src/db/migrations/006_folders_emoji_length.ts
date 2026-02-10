import { Kysely, sql } from 'kysely';

/**
 * Migration 006: Extend folders.emoji length for lucide icon names
 *
 * varchar(8) was for emoji only; we now store lucide icon names (e.g. file-text).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE folders ALTER COLUMN emoji TYPE varchar(48)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE folders ALTER COLUMN emoji TYPE varchar(8)`.execute(db);
}

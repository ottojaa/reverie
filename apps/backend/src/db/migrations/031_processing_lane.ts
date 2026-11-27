import { Kysely, sql } from 'kysely';

/**
 * Processing lane: lets a document's jobs wait behind everyone else's, which is what a phone's photo backup asks for.
 *
 * up(): adds `documents.processing_lane`, 'normal' or 'background'. Existing rows and inserts that do not name the
 * column get 'normal', so code that predates this migration is unaffected.
 *
 * down(): drops the column, and every document is processed as a normal one again.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        ALTER TABLE documents
        ADD COLUMN processing_lane text NOT NULL DEFAULT 'normal'
        CONSTRAINT documents_processing_lane_check CHECK (processing_lane IN ('normal', 'background'))
    `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE documents DROP COLUMN processing_lane`.execute(db);
}

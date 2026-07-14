import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema';

/**
 * Make collections/folders searchable.
 *
 * A folder's searchable text depends only on its own `name` + `description`, so a
 * GENERATED ALWAYS ... STORED tsvector column keeps the index in sync automatically
 * (no trigger, no app-side rebuild call) and backfills every existing row when the
 * column is added. `name` is weighted above `description` so name matches rank higher.
 * Uses the 'english' config to match the query builder's `to_tsquery('english', ...)`.
 */
export async function up(db: Kysely<Database>): Promise<void> {
    await sql`
        ALTER TABLE folders ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(name, '')), 'A')
            || setweight(to_tsvector('english', coalesce(description, '')), 'B')
        ) STORED
    `.execute(db);

    await sql`CREATE INDEX idx_folders_search ON folders USING GIN (search_vector)`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_folders_search`.execute(db);
    await sql`ALTER TABLE folders DROP COLUMN IF EXISTS search_vector`.execute(db);
}

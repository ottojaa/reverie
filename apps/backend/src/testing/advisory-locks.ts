import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

/** How many sessions of this database are waiting for an advisory lock, such as a user's folder lock. */
export async function countAdvisoryLockWaiters(db: Kysely<Database>): Promise<number> {
    const { rows } = await sql<{ count: number }>`
        SELECT count(*)::int AS count FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    `.execute(db);

    return rows[0]!.count;
}

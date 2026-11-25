import { sql, type Kysely } from 'kysely';
import { db } from '../../db/kysely.js';
import type { Database } from '../../db/schema.js';

/**
 * Takes the user's folder lock in `trx`, held until commit (taking it again is harmless). A caller that locks
 * rows before it writes a folder takes this first, so that every folder write locks in the same order.
 */
export async function lockFolders(trx: Kysely<Database>, userId: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'folders:' + userId}))`.execute(trx);
}

/**
 * Runs a folder write in a transaction (the caller's, when given) that first takes the user's folder lock.
 * Writes check the whole tree before changing it, so two at once could otherwise move two folders into each
 * other, or restore a folder while it is being purged.
 */
export function inFolderTransaction<T>(userId: string, run: (trx: Kysely<Database>) => Promise<T>, trx?: Kysely<Database>): Promise<T> {
    async function lockAndRun(t: Kysely<Database>): Promise<T> {
        await lockFolders(t, userId);

        return run(t);
    }

    return trx ? lockAndRun(trx) : db.transaction().execute(lockAndRun);
}

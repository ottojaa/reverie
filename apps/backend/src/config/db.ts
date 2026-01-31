import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../db/schema';
import { env } from './env';

const dialect = new PostgresDialect({
    pool: new Pool({
        connectionString: env.DATABASE_URL,
        max: 10,
    }),
});

export const db = new Kysely<Database>({
    dialect,
    log: env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

export async function checkDbConnection(): Promise<boolean> {
    try {
        await sql`SELECT 1`.execute(db);
        return true;
    } catch {
        return false;
    }
}

export async function closeDb(): Promise<void> {
    await db.destroy();
}

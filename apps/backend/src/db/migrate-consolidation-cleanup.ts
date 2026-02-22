/**
 * One-time script: Run after consolidating migrations into 001_initial_schema.
 * Cleans kysely_migration table so only 001_initial_schema remains.
 * Use when your DB already ran all 14 migrations and you've consolidated them.
 *
 * Run: npx tsx apps/backend/src/db/migrate-consolidation-cleanup.ts
 */
import dotenv from 'dotenv';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
dotenv.config();

async function cleanup() {
    const db = new Kysely({
        dialect: new PostgresDialect({
            pool: new Pool({ connectionString: process.env.DATABASE_URL }),
        }),
    });

    await sql`
        DELETE FROM kysely_migration
        WHERE name != '001_initial_schema'
    `.execute(db);

    console.log('✅ Migration table cleaned. Only 001_initial_schema remains.');
    await db.destroy();
}

cleanup().catch((err) => {
    console.error(err);
    process.exit(1);
});

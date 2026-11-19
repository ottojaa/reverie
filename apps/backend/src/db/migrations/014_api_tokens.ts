import { Kysely, sql } from 'kysely';

/**
 * Revocable API tokens: one row per token, holding only the SHA-256 of the secret.
 *
 * `kind` and `expires_at` leave room for short-lived tokens the backend mints for itself, so
 * adding such a kind later needs no migration; personal tokens have no expiry.
 *
 * Purely additive: a new table that no running code reads or writes until the new code deploys.
 * down() drops it, which revokes every token but touches no library data.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createTable('api_tokens')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('token_hash', 'text', (col) => col.notNull().unique())
        .addColumn('token_prefix', 'text', (col) => col.notNull())
        .addColumn('kind', 'text', (col) => col.notNull().defaultTo('personal'))
        .addColumn('expires_at', 'timestamptz')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('last_used_at', 'timestamptz')
        .addColumn('revoked_at', 'timestamptz')
        .execute();

    await sql`CREATE INDEX idx_api_tokens_user_created ON api_tokens (user_id, created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('api_tokens').execute();
}

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createTable('refresh_tokens')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
        .addColumn('token_hash', 'text', (col) => col.notNull())
        .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema.createIndex('refresh_tokens_token_hash_idx').on('refresh_tokens').column('token_hash').execute();
    await db.schema.createIndex('refresh_tokens_user_id_idx').on('refresh_tokens').column('user_id').execute();
    await db.schema.createIndex('refresh_tokens_expires_at_idx').on('refresh_tokens').column('expires_at').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('refresh_tokens').ifExists().execute();
}

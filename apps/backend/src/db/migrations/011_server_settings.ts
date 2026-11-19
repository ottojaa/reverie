import { Kysely, sql } from 'kysely';

/**
 * Runtime-editable server settings: one row per overridden setting.
 *
 * A setting with no row falls back to its default in the code registry, so this table starts
 * empty and nothing about existing behaviour changes. `value` is JSON so the table stays generic;
 * the registry's Zod schema decides what a valid value is.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createTable('server_settings')
        .addColumn('key', 'text', (col) => col.primaryKey())
        .addColumn('value', 'jsonb', (col) => col.notNull())
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
        .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('server_settings').execute();
}

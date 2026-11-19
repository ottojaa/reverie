import { Kysely, sql } from 'kysely';

/**
 * Audit log for the library tool registry: one row per applied write (and per undo), holding the
 * tool name, its input and the state before and after, so a write can be shown and reversed.
 *
 * Purely additive: a new table that no running code reads or writes until the new code deploys.
 * down() drops it, which loses the history but touches no library data.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createTable('tool_audit_log')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
        .addColumn('tool', 'text', (col) => col.notNull())
        .addColumn('input', 'jsonb', (col) => col.notNull())
        .addColumn('state_before', 'jsonb', (col) => col.notNull())
        .addColumn('state_after', 'jsonb', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('undone_at', 'timestamptz')
        .execute();

    await sql`CREATE INDEX idx_tool_audit_log_user_created ON tool_audit_log (user_id, created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('tool_audit_log').execute();
}

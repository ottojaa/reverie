import { Kysely, sql } from 'kysely';

/**
 * Chats with the in-app agent. The Claude transcript itself lives in the agent container's volume, so
 * Reverie keeps its own copy of what the admin sees: one row per message, its items as JSON.
 * `claude_session_id` is what `--resume` needs to continue a chat.
 *
 * Purely additive: two new tables that no running code reads or writes until the new code deploys.
 * down() drops them, which loses chat history and touches no library data.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createTable('agent_chats')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
        .addColumn('title', 'text', (col) => col.notNull())
        .addColumn('claude_session_id', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await sql`CREATE INDEX idx_agent_chats_user_updated ON agent_chats (user_id, updated_at DESC)`.execute(db);

    await db.schema
        .createTable('agent_messages')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('chat_id', 'uuid', (col) => col.notNull().references('agent_chats.id').onDelete('cascade'))
        .addColumn('role', 'text', (col) => col.notNull())
        .addColumn('items', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
        .addColumn('error', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await sql`CREATE INDEX idx_agent_messages_chat_created ON agent_messages (chat_id, created_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('agent_messages').execute();
    await db.schema.dropTable('agent_chats').execute();
}

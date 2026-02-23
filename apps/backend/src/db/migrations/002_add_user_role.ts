import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('users')
        .addColumn('role', 'text', (col) => col.notNull().defaultTo('user'))
        .execute();

    await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'))`.execute(db);
    await db.schema.createIndex('idx_users_role').on('users').column('role').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`.execute(db);
    await db.schema.dropIndex('idx_users_role').ifExists().on('users').execute();
    await db.schema.alterTable('users').dropColumn('role').execute();
}

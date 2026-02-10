import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('folders')
        .addColumn('type', 'varchar(10)', (col) => col.notNull().defaultTo('section'))
        .execute();

    // Root-level folders (no parent) become categories
    await sql`UPDATE folders SET type = 'category' WHERE parent_id IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('folders').dropColumn('type').execute();
}

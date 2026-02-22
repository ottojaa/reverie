import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    // Add user_id column (nullable initially to populate existing rows)
    await db.schema.alterTable('processing_jobs').addColumn('user_id', 'uuid').execute();

    // Populate from documents for target_type = 'document'
    await sql`
        UPDATE processing_jobs pj
        SET user_id = d.user_id
        FROM documents d
        WHERE pj.target_type = 'document' AND pj.target_id = d.id
    `.execute(db);

    // Populate from folders for target_type = 'folder'
    await sql`
        UPDATE processing_jobs pj
        SET user_id = f.user_id
        FROM folders f
        WHERE pj.target_type = 'folder' AND pj.target_id = f.id
    `.execute(db);

    // Delete orphaned jobs (target no longer exists)
    await sql`
        DELETE FROM processing_jobs WHERE user_id IS NULL
    `.execute(db);

    // Add NOT NULL and FK
    await db.schema
        .alterTable('processing_jobs')
        .alterColumn('user_id', (col) => col.setNotNull())
        .execute();

    await sql`
        ALTER TABLE processing_jobs
        ADD CONSTRAINT processing_jobs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    `.execute(db);

    await db.schema.createIndex('processing_jobs_user_id_idx').on('processing_jobs').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_user_id_fkey`.execute(db);
    await db.schema.dropIndex('processing_jobs_user_id_idx').ifExists().on('processing_jobs').execute();
    await db.schema.alterTable('processing_jobs').dropColumn('user_id').execute();
}

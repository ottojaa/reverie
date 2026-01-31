import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    // Create uuid extension
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db);

    // Create users table (must be created before folders/documents due to FK)
    await db.schema
        .createTable('users')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('email', 'text', (col) => col.notNull().unique())
        .addColumn('password_hash', 'text') // NULL for Google-only users
        .addColumn('google_id', 'text', (col) => col.unique()) // NULL for email/password users
        .addColumn('display_name', 'text', (col) => col.notNull())
        .addColumn('storage_quota_bytes', 'bigint', (col) => col.notNull())
        .addColumn('storage_used_bytes', 'bigint', (col) => col.notNull().defaultTo(0))
        .addColumn('storage_path', 'text', (col) => col.notNull().unique())
        .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('last_login_at', 'timestamptz')
        .execute();

    // Create folders table
    await db.schema
        .createTable('folders')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
        .addColumn('parent_id', 'uuid', (col) => col.references('folders.id').onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('path', 'text', (col) => col.notNull())
        .addColumn('description', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // Create unique constraint on folder path per user
    await db.schema.createIndex('idx_folders_user_path').on('folders').columns(['user_id', 'path']).unique().execute();

    // Create documents table
    await db.schema
        .createTable('documents')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
        .addColumn('folder_id', 'uuid', (col) => col.references('folders.id').onDelete('set null'))
        .addColumn('file_path', 'text', (col) => col.notNull())
        .addColumn('file_hash', 'text', (col) => col.notNull())
        .addColumn('original_filename', 'text', (col) => col.notNull())
        .addColumn('mime_type', 'text', (col) => col.notNull())
        .addColumn('size_bytes', 'bigint', (col) => col.notNull())
        .addColumn('width', 'integer')
        .addColumn('height', 'integer')
        .addColumn('thumbnail_blurhash', 'text')
        .addColumn('thumbnail_paths', 'jsonb')
        .addColumn('document_category', 'text')
        .addColumn('extracted_date', 'date')
        .addColumn('ocr_status', 'text', (col) => col.notNull().defaultTo('pending'))
        .addColumn('thumbnail_status', 'text', (col) => col.notNull().defaultTo('pending'))
        .addColumn('llm_summary', 'text')
        .addColumn('llm_metadata', 'jsonb')
        .addColumn('llm_processed_at', 'timestamptz')
        .addColumn('llm_token_count', 'integer')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // Create ocr_results table
    await db.schema
        .createTable('ocr_results')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('document_id', 'uuid', (col) => col.references('documents.id').onDelete('cascade').notNull().unique())
        .addColumn('raw_text', 'text', (col) => col.notNull())
        .addColumn('confidence_score', 'real')
        .addColumn('metadata', 'jsonb')
        .addColumn('text_vector', sql`tsvector`)
        .addColumn('processed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // Create processing_jobs table
    await db.schema
        .createTable('processing_jobs')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('job_type', 'text', (col) => col.notNull())
        .addColumn('target_type', 'text', (col) => col.notNull())
        .addColumn('target_id', 'uuid', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
        .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('error_message', 'text')
        .addColumn('result', 'jsonb')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('started_at', 'timestamptz')
        .addColumn('completed_at', 'timestamptz')
        .execute();

    // Create document_tags table
    await db.schema
        .createTable('document_tags')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('document_id', 'uuid', (col) => col.references('documents.id').onDelete('cascade').notNull())
        .addColumn('tag', 'text', (col) => col.notNull())
        .addColumn('source', 'text', (col) => col.notNull().defaultTo('user'))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // Add unique constraint on document_tags (document_id, tag)
    await db.schema.alterTable('document_tags').addUniqueConstraint('document_tags_document_id_tag_unique', ['document_id', 'tag']).execute();

    // Create indexes
    await db.schema.createIndex('idx_documents_hash').on('documents').column('file_hash').execute();

    await db.schema.createIndex('idx_documents_category').on('documents').column('document_category').execute();

    await db.schema.createIndex('idx_documents_extracted_date').on('documents').column('extracted_date').execute();

    await db.schema.createIndex('idx_documents_folder').on('documents').column('folder_id').execute();

    await db.schema.createIndex('idx_documents_user').on('documents').column('user_id').execute();

    await db.schema.createIndex('idx_folders_user').on('folders').column('user_id').execute();

    await db.schema.createIndex('idx_document_tags_tag').on('document_tags').column('tag').execute();

    await db.schema.createIndex('idx_processing_jobs_status').on('processing_jobs').columns(['status', 'job_type']).execute();

    await db.schema.createIndex('idx_processing_jobs_target').on('processing_jobs').columns(['target_type', 'target_id']).execute();

    // Create GIN index for full-text search
    await sql`CREATE INDEX idx_ocr_text_search ON ocr_results USING GIN(text_vector)`.execute(db);

    // Create function to automatically update text_vector
    await sql`
    CREATE OR REPLACE FUNCTION update_ocr_text_vector()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.text_vector := to_tsvector('english', COALESCE(NEW.raw_text, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

    // Create trigger for text_vector updates
    await sql`
    CREATE TRIGGER ocr_text_vector_trigger
    BEFORE INSERT OR UPDATE OF raw_text ON ocr_results
    FOR EACH ROW EXECUTE FUNCTION update_ocr_text_vector()
  `.execute(db);

    // Create updated_at trigger function
    await sql`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

    // Add updated_at triggers
    await sql`
    CREATE TRIGGER folders_updated_at
    BEFORE UPDATE ON folders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at()
  `.execute(db);

    await sql`
    CREATE TRIGGER documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at()
  `.execute(db);

    await sql`
    CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    // Drop triggers
    await sql`DROP TRIGGER IF EXISTS users_updated_at ON users`.execute(db);
    await sql`DROP TRIGGER IF EXISTS documents_updated_at ON documents`.execute(db);
    await sql`DROP TRIGGER IF EXISTS folders_updated_at ON folders`.execute(db);
    await sql`DROP TRIGGER IF EXISTS ocr_text_vector_trigger ON ocr_results`.execute(db);

    // Drop functions
    await sql`DROP FUNCTION IF EXISTS update_updated_at()`.execute(db);
    await sql`DROP FUNCTION IF EXISTS update_ocr_text_vector()`.execute(db);

    // Drop tables in reverse order (users last due to FK)
    await db.schema.dropTable('document_tags').ifExists().execute();
    await db.schema.dropTable('processing_jobs').ifExists().execute();
    await db.schema.dropTable('ocr_results').ifExists().execute();
    await db.schema.dropTable('documents').ifExists().execute();
    await db.schema.dropTable('folders').ifExists().execute();
    await db.schema.dropTable('users').ifExists().execute();
}

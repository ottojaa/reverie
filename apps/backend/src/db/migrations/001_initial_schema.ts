import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    // Extensions
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db);
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

    // Users table
    await db.schema
        .createTable('users')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('email', 'text', (col) => col.notNull().unique())
        .addColumn('password_hash', 'text')
        .addColumn('google_id', 'text', (col) => col.unique())
        .addColumn('display_name', 'text', (col) => col.notNull())
        .addColumn('storage_quota_bytes', 'bigint', (col) => col.notNull())
        .addColumn('storage_used_bytes', 'bigint', (col) => col.notNull().defaultTo(0))
        .addColumn('storage_path', 'text', (col) => col.notNull().unique())
        .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('last_login_at', 'timestamptz')
        .execute();

    // Refresh tokens table
    await db.schema
        .createTable('refresh_tokens')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
        .addColumn('token_hash', 'text', (col) => col.notNull())
        .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // Folders table (emoji varchar(48), sort_order, type from 004-006)
    await db.schema
        .createTable('folders')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
        .addColumn('parent_id', 'uuid', (col) => col.references('folders.id').onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('path', 'text', (col) => col.notNull())
        .addColumn('description', 'text')
        .addColumn('emoji', 'varchar(48)')
        .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('type', 'varchar(10)', (col) => col.notNull().defaultTo('section'))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema.createIndex('idx_folders_user_path').on('folders').columns(['user_id', 'path']).unique().execute();

    // Documents table (no llm_* columns; has has_meaningful_text, llm_status, search_vector)
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
        .addColumn('llm_status', 'text', (col) => col.notNull().defaultTo('skipped'))
        .addColumn('has_meaningful_text', 'boolean', (col) => col.defaultTo(true))
        .addColumn('search_vector', sql`tsvector`)
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // OCR results table (text_density, has_meaningful_text, ocr_engine, duration_ms)
    await db.schema
        .createTable('ocr_results')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('document_id', 'uuid', (col) => col.references('documents.id').onDelete('cascade').notNull().unique())
        .addColumn('raw_text', 'text', (col) => col.notNull())
        .addColumn('confidence_score', 'real')
        .addColumn('text_density', 'real')
        .addColumn('has_meaningful_text', 'boolean', (col) => col.defaultTo(true))
        .addColumn('metadata', 'jsonb')
        .addColumn('text_vector', sql`tsvector`)
        .addColumn('ocr_engine', 'varchar(100)', (col) => col.defaultTo(sql`'unknown'`))
        .addColumn('duration_ms', 'integer')
        .addColumn('processed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // LLM results table
    await db.schema
        .createTable('llm_results')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('document_id', 'uuid', (col) => col.references('documents.id').onDelete('cascade').notNull().unique())
        .addColumn('summary', 'text')
        .addColumn('metadata', 'jsonb')
        .addColumn('token_count', 'integer')
        .addColumn('processing_type', 'text')
        .addColumn('duration_ms', 'integer')
        .addColumn('processed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // Processing jobs table (user_id FK, duration_ms)
    await db.schema
        .createTable('processing_jobs')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
        .addColumn('job_type', 'text', (col) => col.notNull())
        .addColumn('target_type', 'text', (col) => col.notNull())
        .addColumn('target_id', 'uuid', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
        .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('error_message', 'text')
        .addColumn('result', 'jsonb')
        .addColumn('duration_ms', 'integer')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('started_at', 'timestamptz')
        .addColumn('completed_at', 'timestamptz')
        .execute();

    // Document tags table
    await db.schema
        .createTable('document_tags')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
        .addColumn('document_id', 'uuid', (col) => col.references('documents.id').onDelete('cascade').notNull())
        .addColumn('tag', 'text', (col) => col.notNull())
        .addColumn('source', 'text', (col) => col.notNull().defaultTo('user'))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema.alterTable('document_tags').addUniqueConstraint('document_tags_document_id_tag_unique', ['document_id', 'tag']).execute();

    // Photo metadata table
    await db.schema
        .createTable('photo_metadata')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('document_id', 'uuid', (col) => col.notNull().unique().references('documents.id').onDelete('cascade'))
        .addColumn('latitude', 'real')
        .addColumn('longitude', 'real')
        .addColumn('country', 'text')
        .addColumn('city', 'text')
        .addColumn('taken_at', 'timestamptz')
        .addColumn('processed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    // Root-level folders become categories
    await sql`UPDATE folders SET type = 'category' WHERE parent_id IS NULL`.execute(db);

    // Indexes - documents
    await db.schema.createIndex('idx_documents_hash').on('documents').column('file_hash').execute();
    await db.schema.createIndex('idx_documents_category').on('documents').column('document_category').execute();
    await db.schema.createIndex('idx_documents_extracted_date').on('documents').column('extracted_date').execute();
    await db.schema.createIndex('idx_documents_folder').on('documents').column('folder_id').execute();
    await db.schema.createIndex('idx_documents_user').on('documents').column('user_id').execute();
    await db.schema.createIndex('idx_documents_mime_type').on('documents').column('mime_type').execute();
    await db.schema.createIndex('idx_documents_created_at').on('documents').column('created_at').execute();
    await db.schema.createIndex('idx_documents_size_bytes').on('documents').column('size_bytes').execute();
    await db.schema.createIndex('idx_documents_has_meaningful_text').on('documents').column('has_meaningful_text').execute();
    await sql`CREATE INDEX idx_documents_filename_trgm ON documents USING GIN(original_filename gin_trgm_ops)`.execute(db);
    await sql`CREATE INDEX idx_documents_user_created ON documents (user_id, created_at DESC)`.execute(db);
    await sql`CREATE INDEX idx_documents_user_has_text ON documents (user_id, has_meaningful_text)`.execute(db);
    await sql`CREATE INDEX idx_documents_search_vector ON documents USING GIN(search_vector)`.execute(db);

    // Indexes - folders
    await db.schema.createIndex('idx_folders_user').on('folders').column('user_id').execute();
    await db.schema.createIndex('idx_folders_path').on('folders').column('path').execute();
    await sql`CREATE INDEX idx_folders_sort_order ON folders(user_id, parent_id, sort_order)`.execute(db);

    // Indexes - ocr_results
    await sql`CREATE INDEX idx_ocr_text_search ON ocr_results USING GIN(text_vector)`.execute(db);
    await sql`CREATE INDEX idx_ocr_metadata_companies ON ocr_results USING GIN((metadata->'companies'))`.execute(db);

    // Indexes - llm_results
    await sql`CREATE INDEX idx_llm_results_summary ON llm_results (document_id) WHERE summary IS NOT NULL`.execute(db);
    await sql`CREATE INDEX idx_llm_results_entities ON llm_results USING GIN ((metadata->'keyEntities'))`.execute(db);

    // Indexes - processing_jobs
    await db.schema.createIndex('idx_processing_jobs_status').on('processing_jobs').columns(['status', 'job_type']).execute();
    await db.schema.createIndex('idx_processing_jobs_target').on('processing_jobs').columns(['target_type', 'target_id']).execute();
    await db.schema.createIndex('processing_jobs_user_id_idx').on('processing_jobs').column('user_id').execute();

    // Indexes - document_tags
    await db.schema.createIndex('idx_document_tags_tag').on('document_tags').column('tag').execute();
    await sql`CREATE INDEX idx_document_tags_document_tag ON document_tags (document_id, tag)`.execute(db);

    // Indexes - photo_metadata
    await sql`CREATE INDEX idx_photo_metadata_country ON photo_metadata(country)`.execute(db);
    await sql`CREATE INDEX idx_photo_metadata_city ON photo_metadata(city)`.execute(db);
    await sql`CREATE INDEX idx_photo_metadata_taken_at ON photo_metadata(taken_at)`.execute(db);
    await sql`CREATE INDEX idx_photo_metadata_location ON photo_metadata(country, city)`.execute(db);

    // Indexes - refresh_tokens
    await db.schema.createIndex('refresh_tokens_token_hash_idx').on('refresh_tokens').column('token_hash').execute();
    await db.schema.createIndex('refresh_tokens_user_id_idx').on('refresh_tokens').column('user_id').execute();
    await db.schema.createIndex('refresh_tokens_expires_at_idx').on('refresh_tokens').column('expires_at').execute();

    // update_ocr_text_vector - 002 version (checks has_meaningful_text)
    await sql`
    CREATE OR REPLACE FUNCTION update_ocr_text_vector()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.has_meaningful_text = true THEN
        NEW.text_vector := to_tsvector('english', COALESCE(NEW.raw_text, ''));
      ELSE
        NEW.text_vector := NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

    await sql`
    CREATE TRIGGER ocr_text_vector_trigger
    BEFORE INSERT OR UPDATE OF raw_text, has_meaningful_text ON ocr_results
    FOR EACH ROW EXECUTE FUNCTION update_ocr_text_vector()
  `.execute(db);

    /**
     * Aggregates all searchable metadata into a single weighted tsvector on the
     * documents table so that natural-language queries like "spain 2024" match
     * photos with country=Spain and taken_at in 2024.
     *
     * Weighted tsvector layout:
     *   A - LLM title (highest signal)
     *   B - Tags, entities, document category, filename
     *   C - Photo city, country, date tokens (year + month names)
     *   D - OCR raw text, LLM summary (bulk content)
     */
    await sql`
    CREATE OR REPLACE FUNCTION rebuild_document_search_vector(doc_id uuid)
    RETURNS void AS $$
    DECLARE
        v_filename       text;
        v_category       text;
        v_ocr_text       text;
        v_llm_title      text;
        v_llm_summary    text;
        v_city           text;
        v_country        text;
        v_taken_at       timestamptz;
        v_extracted_date date;
        v_tags_text      text;
        v_date_tokens    text := '';
        v_vec            tsvector;
    BEGIN
        SELECT d.original_filename, d.document_category, d.extracted_date
          INTO v_filename, v_category, v_extracted_date
          FROM documents d WHERE d.id = doc_id;

        IF NOT FOUND THEN RETURN; END IF;

        SELECT ocr.raw_text INTO v_ocr_text
          FROM ocr_results ocr WHERE ocr.document_id = doc_id;

        SELECT llm.metadata->>'title', llm.summary
          INTO v_llm_title, v_llm_summary
          FROM llm_results llm WHERE llm.document_id = doc_id;

        SELECT pm.city, pm.country, pm.taken_at
          INTO v_city, v_country, v_taken_at
          FROM photo_metadata pm WHERE pm.document_id = doc_id;

        SELECT string_agg(dt.tag, ' ')
          INTO v_tags_text
          FROM document_tags dt WHERE dt.document_id = doc_id;

        IF v_taken_at IS NOT NULL THEN
            v_date_tokens := to_char(v_taken_at, 'YYYY')
                || ' ' || to_char(v_taken_at, 'FMMonth')
                || ' ' || to_char(v_taken_at, 'FMMonth YYYY');
        ELSIF v_extracted_date IS NOT NULL THEN
            v_date_tokens := to_char(v_extracted_date, 'YYYY')
                || ' ' || to_char(v_extracted_date, 'FMMonth')
                || ' ' || to_char(v_extracted_date, 'FMMonth YYYY');
        END IF;

        v_vec :=
            setweight(to_tsvector('english', COALESCE(v_llm_title, '')), 'A')
            || setweight(to_tsvector('english',
                COALESCE(v_tags_text, '')
                || ' ' || COALESCE(v_category, '')
                || ' ' || COALESCE(v_filename, '')
            ), 'B')
            || setweight(to_tsvector('english',
                COALESCE(v_city, '')
                || ' ' || COALESCE(v_country, '')
                || ' ' || v_date_tokens
            ), 'C')
            || setweight(to_tsvector('english',
                COALESCE(v_ocr_text, '')
                || ' ' || COALESCE(v_llm_summary, '')
            ), 'D');

        UPDATE documents SET search_vector = v_vec WHERE id = doc_id;
    END;
    $$ LANGUAGE plpgsql;
    `.execute(db);

    // update_updated_at
    await sql`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

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
    await sql`DROP FUNCTION IF EXISTS rebuild_document_search_vector(uuid)`.execute(db);
    await sql`DROP FUNCTION IF EXISTS update_updated_at()`.execute(db);
    await sql`DROP FUNCTION IF EXISTS update_ocr_text_vector()`.execute(db);

    // Drop tables in reverse FK order
    await db.schema.dropTable('photo_metadata').ifExists().execute();
    await db.schema.dropTable('document_tags').ifExists().execute();
    await db.schema.dropTable('refresh_tokens').ifExists().execute();
    await db.schema.dropTable('processing_jobs').ifExists().execute();
    await db.schema.dropTable('llm_results').ifExists().execute();
    await db.schema.dropTable('ocr_results').ifExists().execute();
    await db.schema.dropTable('documents').ifExists().execute();
    await db.schema.dropTable('folders').ifExists().execute();
    await db.schema.dropTable('users').ifExists().execute();
}

import { Kysely, sql } from 'kysely';

/**
 * Migration 003: Search-specific indexes
 *
 * Adds additional indexes to optimize search queries:
 * - Trigram index for fuzzy filename matching
 * - JSONB indexes for entity search in OCR metadata
 * - Additional B-tree indexes for common filters
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    // Install pg_trgm extension for trigram similarity (fuzzy matching)
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

    // Trigram index on filename for fuzzy search
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_filename_trgm 
              ON documents USING GIN(original_filename gin_trgm_ops)`.execute(db);

    // Index on mime_type for format filtering
    await db.schema.createIndex('idx_documents_mime_type').on('documents').column('mime_type').ifNotExists().execute();

    // Index on created_at for upload date filtering
    await db.schema.createIndex('idx_documents_created_at').on('documents').column('created_at').ifNotExists().execute();

    // Index on size_bytes for size filtering
    await db.schema.createIndex('idx_documents_size_bytes').on('documents').column('size_bytes').ifNotExists().execute();

    // Index on has_meaningful_text for type filtering
    await db.schema.createIndex('idx_documents_has_meaningful_text').on('documents').column('has_meaningful_text').ifNotExists().execute();

    // Index on folder path for folder filtering
    await db.schema.createIndex('idx_folders_path').on('folders').column('path').ifNotExists().execute();

    // JSONB GIN index on OCR metadata companies array for entity search
    await sql`CREATE INDEX IF NOT EXISTS idx_ocr_metadata_companies 
              ON ocr_results USING GIN((metadata->'companies'))`.execute(db);

    // JSONB GIN index on LLM metadata key entities for entity search
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_llm_key_entities 
              ON documents USING GIN((llm_metadata->'keyEntities'))`.execute(db);

    // Index on llm_summary for summary text search (nullable column)
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_llm_summary 
              ON documents (llm_summary) 
              WHERE llm_summary IS NOT NULL`.execute(db);

    // Composite index for common search patterns: user + created_at
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_user_created 
              ON documents (user_id, created_at DESC)`.execute(db);

    // Composite index for user + has_meaningful_text (for photo/document type filtering)
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_user_has_text 
              ON documents (user_id, has_meaningful_text)`.execute(db);

    // Index on document_tags for efficient tag lookups
    await sql`CREATE INDEX IF NOT EXISTS idx_document_tags_document_tag 
              ON document_tags (document_id, tag)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes in reverse order
    await sql`DROP INDEX IF EXISTS idx_document_tags_document_tag`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_user_has_text`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_user_created`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_llm_summary`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_llm_key_entities`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_ocr_metadata_companies`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_folders_path`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_has_meaningful_text`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_size_bytes`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_mime_type`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_filename_trgm`.execute(db);

    // Note: We don't drop pg_trgm extension as other parts of the app might use it
}

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    // 1. Create llm_results table
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

    // 2. Drop LLM columns from documents
    // Drop the index on llm_summary first (created in migration 003)
    await sql`DROP INDEX IF EXISTS idx_documents_llm_summary`.execute(db);
    // Drop the GIN index on llm_metadata->keyEntities (created in migration 003)
    await sql`DROP INDEX IF EXISTS idx_documents_llm_entities`.execute(db);

    await db.schema.alterTable('documents').dropColumn('llm_summary').execute();
    await db.schema.alterTable('documents').dropColumn('llm_metadata').execute();
    await db.schema.alterTable('documents').dropColumn('llm_processed_at').execute();
    await db.schema.alterTable('documents').dropColumn('llm_token_count').execute();

    // 3. Add duration_ms to processing_jobs
    await db.schema.alterTable('processing_jobs').addColumn('duration_ms', 'integer').execute();

    // 4. Add duration_ms to ocr_results
    await db.schema.alterTable('ocr_results').addColumn('duration_ms', 'integer').execute();

    // 5. Create indexes on llm_results
    await sql`CREATE INDEX idx_llm_results_summary ON llm_results (document_id) WHERE summary IS NOT NULL`.execute(db);
    await sql`CREATE INDEX idx_llm_results_entities ON llm_results USING GIN ((metadata->'keyEntities'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    // Remove duration_ms from ocr_results
    await db.schema.alterTable('ocr_results').dropColumn('duration_ms').execute();

    // Remove duration_ms from processing_jobs
    await db.schema.alterTable('processing_jobs').dropColumn('duration_ms').execute();

    // Re-add LLM columns to documents
    await db.schema.alterTable('documents').addColumn('llm_summary', 'text').execute();
    await db.schema.alterTable('documents').addColumn('llm_metadata', 'jsonb').execute();
    await db.schema.alterTable('documents').addColumn('llm_processed_at', 'timestamptz').execute();
    await db.schema.alterTable('documents').addColumn('llm_token_count', 'integer').execute();

    // Drop llm_results table
    await db.schema.dropTable('llm_results').ifExists().execute();
}

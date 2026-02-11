import { Kysely, sql } from 'kysely';

/**
 * Add llm_status to documents (mirrors ocr_status pattern)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('documents')
        .addColumn('llm_status', 'text', (col) => col.notNull().defaultTo('pending'))
        .execute();

    // Backfill: docs with llm_processed_at are complete
    await sql`UPDATE documents SET llm_status = 'complete' WHERE llm_processed_at IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('documents').dropColumn('llm_status').execute();
}

import { type Kysely, sql } from 'kysely';

/**
 * Fix llm_status: migration 007 added the column with default 'pending' and
 * backfilled only llm_processed_at → 'complete'. Documents without LLM
 * processing were left as 'pending', causing false processing overlays.
 * Fix those to 'skipped' and set the default for future inserts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    // Fix wrong state from 007: pending + no llm_processed_at → skipped
    await sql`UPDATE documents SET llm_status = 'skipped' WHERE llm_processed_at IS NULL AND llm_status = 'pending'`.execute(db);

    // Set default for future inserts
    await db.schema.alterTable('documents').alterColumn('llm_status', (ac) => ac.setDefault('skipped')).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('documents').alterColumn('llm_status', (ac) => ac.setDefault('pending')).execute();

    await sql`UPDATE documents SET llm_status = 'pending' WHERE llm_processed_at IS NULL AND llm_status = 'skipped'`.execute(db);
}

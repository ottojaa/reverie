import type { Kysely } from 'kysely';
import type { Database } from '../schema';

/**
 * Fix llm_status: migration 007 added the column with default 'pending' and
 * backfilled only llm_processed_at → 'complete'. Documents without LLM
 * processing were left as 'pending', causing false processing overlays.
 * Fix those to 'skipped' and set the default for future inserts.
 */
export async function up(db: Kysely<Database>): Promise<void> {
    // Fix wrong state from 007: pending + no llm_processed_at → skipped
    await db
        .updateTable('documents')
        .set({ llm_status: 'skipped' })
        .where('llm_processed_at', 'is', null)
        .where('llm_status', '=', 'pending')
        .execute();

    // Set default for future inserts
    await db
        .schema
        .alterTable('documents')
        .alterColumn('llm_status', (ac) => ac.setDefault('skipped'))
        .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
    await db
        .schema
        .alterTable('documents')
        .alterColumn('llm_status', (ac) => ac.setDefault('pending'))
        .execute();

    await db
        .updateTable('documents')
        .set({ llm_status: 'pending' })
        .where('llm_processed_at', 'is', null)
        .where('llm_status', '=', 'skipped')
        .execute();
}

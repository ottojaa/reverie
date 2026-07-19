import { Kysely } from 'kysely';

/**
 * Video duration.
 *
 * documents.duration_seconds holds a video's length in seconds, probed with ffprobe in the
 * thumbnail worker while the temp file exists. Nullable: non-video documents never set it, and
 * existing videos stay null until their thumbnail job is reprocessed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('documents').addColumn('duration_seconds', 'double precision').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('documents').dropColumn('duration_seconds').execute();
}

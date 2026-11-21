import { Kysely, sql } from 'kysely';

/**
 * The HLS ladder for every video (the transcode worker; nothing is served yet).
 *
 * up():
 *  1. `documents.transcode_status`: the same status values as ocr_status and thumbnail_status. 'skipped' is the default,
 *     so code that predates this migration (which inserts documents without it) is unaffected; every existing video is
 *     set to 'pending', which is what the transcode backfill looks for.
 *  2. `transcode_sets`: one row per finished set of renditions, keyed by the content hash of the original, so identical
 *     uploads share one set. `files` lists every stored file (the storage providers cannot list a prefix), and the row
 *     is written after the last file, so a row means a complete set. A purge removes the set when the last document with
 *     that hash goes.
 *
 * Nothing in running code reads either, so it can be deployed ahead of the code that fills them.
 *
 * down(): drops both. The renditions already stored stay on disk as orphans under `transcode/`: they are derived data,
 * and removing the directory by hand is safe.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE documents ADD COLUMN transcode_status text NOT NULL DEFAULT 'skipped'`.execute(db);
    await sql`UPDATE documents SET transcode_status = 'pending' WHERE mime_type LIKE 'video/%'`.execute(db);

    await sql`
        CREATE TABLE transcode_sets (
            file_hash text PRIMARY KEY,
            files jsonb NOT NULL,
            rungs jsonb NOT NULL,
            encoder text NOT NULL,
            tone_map text,
            total_bytes bigint NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS transcode_sets`.execute(db);
    await sql`ALTER TABLE documents DROP COLUMN IF EXISTS transcode_status`.execute(db);
}

import { Kysely, sql } from 'kysely';

/**
 * `documents.camera_read_at`: when the image's camera EXIF (make, model, lens, GPS) was last read from its stored
 * file into `photo_metadata`. Null means "not read yet": the OCR worker sets it with the EXIF it stores, and the
 * embed backfill's camera stage reads every image that has none. Until an image is read, its capture date still
 * holds it back from Claude (a date alone stops counting once the camera columns have been read).
 *
 * Nothing in running code reads it yet, and code that predates this migration ignores it, so it can be deployed ahead
 * of the code that fills it. No existing row is marked read: the backfill reads each image once.
 *
 * down(): drops the column. The backfill starts over and rereads, filling only what is missing.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE documents ADD COLUMN camera_read_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE documents DROP COLUMN IF EXISTS camera_read_at`.execute(db);
}

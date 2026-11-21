import { Kysely, sql } from 'kysely';

/**
 * Full EXIF for photos and ffprobe facts for videos, kept in columns so a timeline, a map or a transcoder can query
 * them without reading the files again. Nothing in running code reads any of it yet, and code that predates this
 * migration ignores it, so it can be deployed ahead of the code that fills it.
 *
 * up():
 *  1. `photo_metadata`: iso, f_number, exposure_time (seconds), focal_length and focal_length_35mm (mm), flash_fired,
 *     orientation (EXIF 1-8), pixel_width and pixel_height (the size as shot, from EXIF), and taken_at_offset.
 *     `taken_at` is the clock reading as if it were UTC, and `taken_at_offset` ('+02:00') is the offset that clock was
 *     in when the file says so (null when it does not): the instant is taken_at minus the offset. Photos and videos
 *     use the same two columns, so a timeline can treat them alike.
 *  2. `video_metadata`: one row per video with the ffprobe facts (container, codecs, bitrate, size, frame rate,
 *     rotation, colour/HDR, container creation time). A video's GPS and capture date go to `photo_metadata`, the row
 *     photos use, so the place and date fields are read from one table. Cascades with the document.
 *  3. `documents.media_read_at`: when the full EXIF (images) or the ffprobe facts (videos) were read from the stored
 *     file. Null means "not read yet": the OCR worker and the thumbnail worker set it as they store the facts, and the
 *     embed backfill's camera stage reads every image and video that has none. `camera_read_at` keeps its own meaning
 *     (the photo-or-screenshot rules read it), so no existing row is touched: the backfill reads each file once.
 *
 * down(): drops all of it. The backfill starts over and rereads, filling only what is missing.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        ALTER TABLE photo_metadata
            ADD COLUMN iso integer,
            ADD COLUMN f_number double precision,
            ADD COLUMN exposure_time double precision,
            ADD COLUMN focal_length double precision,
            ADD COLUMN focal_length_35mm double precision,
            ADD COLUMN flash_fired boolean,
            ADD COLUMN orientation smallint,
            ADD COLUMN taken_at_offset text,
            ADD COLUMN pixel_width integer,
            ADD COLUMN pixel_height integer
    `.execute(db);

    await sql`
        CREATE TABLE video_metadata (
            document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
            container text,
            video_codec text,
            video_profile text,
            pixel_format text,
            audio_codec text,
            bitrate integer,
            width integer,
            height integer,
            frame_rate double precision,
            rotation smallint,
            color_transfer text,
            color_primaries text,
            color_space text,
            is_hdr boolean NOT NULL DEFAULT false,
            creation_time timestamptz,
            processed_at timestamptz NOT NULL DEFAULT now()
        )
    `.execute(db);

    await sql`ALTER TABLE documents ADD COLUMN media_read_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE documents DROP COLUMN IF EXISTS media_read_at`.execute(db);
    await sql`DROP TABLE IF EXISTS video_metadata`.execute(db);
    await sql`
        ALTER TABLE photo_metadata
            DROP COLUMN IF EXISTS iso,
            DROP COLUMN IF EXISTS f_number,
            DROP COLUMN IF EXISTS exposure_time,
            DROP COLUMN IF EXISTS focal_length,
            DROP COLUMN IF EXISTS focal_length_35mm,
            DROP COLUMN IF EXISTS flash_fired,
            DROP COLUMN IF EXISTS orientation,
            DROP COLUMN IF EXISTS taken_at_offset,
            DROP COLUMN IF EXISTS pixel_width,
            DROP COLUMN IF EXISTS pixel_height
    `.execute(db);
}

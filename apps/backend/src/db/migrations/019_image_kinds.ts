import { Kysely, sql } from 'kysely';

/**
 * Local image-kind classification (shadow mode). Nothing in running code reads these yet, and code that predates
 * this migration ignores them, so it can be deployed ahead of the code that fills them.
 *
 * up():
 *  1. `document_image_kinds`: one row per image document with the classifier's verdict (photo, screenshot,
 *     document, receipt, diagram, other), the per-kind scores, the signals behind it, the classifier version
 *     (prompts and thresholds) and the image model the embedding came from. Cascades with the document.
 *  2. `photo_metadata`: nullable camera_make, camera_model and lens_model, read from EXIF by the OCR worker.
 *  3. `documents.ocr_facts_at`: set by the OCR worker once it has stored the OCR text flag and EXIF (null while it
 *     runs, and for images processed before this migration). The flipped LLM trigger waits for it.
 *
 * down(): drops all of it. The verdicts are derived data: the embed backfill rebuilds them.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        CREATE TABLE document_image_kinds (
            document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
            kind text NOT NULL,
            scores jsonb NOT NULL,
            signals jsonb NOT NULL,
            prompt_version text NOT NULL,
            model text NOT NULL,
            model_version text NOT NULL,
            classified_at timestamptz NOT NULL DEFAULT now()
        )
    `.execute(db);

    await sql`ALTER TABLE photo_metadata ADD COLUMN camera_make text, ADD COLUMN camera_model text, ADD COLUMN lens_model text`.execute(db);
    await sql`ALTER TABLE documents ADD COLUMN ocr_facts_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE documents DROP COLUMN IF EXISTS ocr_facts_at`.execute(db);
    await sql`ALTER TABLE photo_metadata DROP COLUMN IF EXISTS camera_make, DROP COLUMN IF EXISTS camera_model, DROP COLUMN IF EXISTS lens_model`.execute(db);
    await sql`DROP TABLE IF EXISTS document_image_kinds`.execute(db);
}

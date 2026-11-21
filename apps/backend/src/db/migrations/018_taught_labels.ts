import { Kysely, sql } from 'kysely';

/**
 * Labels taught by example: a user marks a few images with a label of their own and every image that
 * looks like them (by image-embedding similarity) gets that label as a tag.
 *
 * up():
 *  1. `taught_labels`: one row per label. `name` is the tag text it puts on images (lowercase, like every
 *     tag), unique per user. `threshold` is the cosine similarity an image must reach to a single example;
 *     `threshold_is_custom` says whether the user moved it (otherwise it follows the examples' spread).
 *  2. `taught_label_examples`: the images the user taught the label from.
 *  3. `taught_label_exclusions`: images the user removed the label from; propagation never re-adds it there.
 *  Both link tables cascade from the label and from the document.
 *
 * A taught tag is a plain `document_tags` row with `source = 'taught'`: the column is free text, so no schema
 * change is needed and running code (which only ever deletes `auto` rows and reads `user` rows) ignores it.
 *
 * down(): deletes the taught tag rows (and rebuilds those documents' search vectors, since tags are indexed),
 * then drops the three tables. Nothing else depends on them.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        CREATE TABLE taught_labels (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name text NOT NULL,
            threshold real NOT NULL,
            threshold_is_custom boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (user_id, name)
        )
    `.execute(db);

    await sql`
        CREATE TABLE taught_label_examples (
            label_id uuid NOT NULL REFERENCES taught_labels(id) ON DELETE CASCADE,
            document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (label_id, document_id)
        )
    `.execute(db);
    await sql`CREATE INDEX idx_taught_label_examples_document ON taught_label_examples (document_id)`.execute(db);

    await sql`
        CREATE TABLE taught_label_exclusions (
            label_id uuid NOT NULL REFERENCES taught_labels(id) ON DELETE CASCADE,
            document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (label_id, document_id)
        )
    `.execute(db);
    await sql`CREATE INDEX idx_taught_label_exclusions_document ON taught_label_exclusions (document_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    const touched = await sql<{ document_id: string }>`DELETE FROM document_tags WHERE source = 'taught' RETURNING document_id`.execute(db);
    const ids = Array.from(new Set(touched.rows.map((row) => row.document_id)));

    if (ids.length > 0) await sql`SELECT rebuild_document_search_vector(id) FROM unnest(${ids}::uuid[]) AS id`.execute(db);

    await sql`DROP TABLE IF EXISTS taught_label_exclusions`.execute(db);
    await sql`DROP TABLE IF EXISTS taught_label_examples`.execute(db);
    await sql`DROP TABLE IF EXISTS taught_labels`.execute(db);
}

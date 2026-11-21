import { Kysely, sql } from 'kysely';

/**
 * Frozen seed sets for the image-kind classifier. A classifier version that scores by similarity to the library's own
 * confident examples needs those examples to stay fixed, or a verdict would move as the library grows. They are taken
 * once per version (scripts/snapshot-image-kind-seeds.ts) and live here, not in the repo: they derive from private photos.
 *
 * up():
 *  1. `image_kind_seed_sets`: one row per classifier version: the image model the seeds were embedded with and the
 *     statistics (means and deviations) that put similarities and prompt scores on one scale.
 *  2. `image_kind_seeds`: the seed documents of a version and the kind each stands for. Cascades with the set and
 *     with the document: a deleted seed just drops out (its stored embedding goes with it).
 *
 * Nothing in running code that predates this migration reads them, and an empty table means "no seed set yet": the
 * classifier then classifies nothing, so this can be deployed ahead of the snapshot.
 *
 * down(): drops both. The seed set is derived data: take the snapshot again.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        CREATE TABLE image_kind_seed_sets (
            version text PRIMARY KEY,
            model text NOT NULL,
            model_version text NOT NULL,
            stats jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `.execute(db);

    await sql`
        CREATE TABLE image_kind_seeds (
            version text NOT NULL REFERENCES image_kind_seed_sets(version) ON DELETE CASCADE,
            document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            kind text NOT NULL,
            PRIMARY KEY (version, document_id)
        )
    `.execute(db);

    await sql`CREATE INDEX image_kind_seeds_document_idx ON image_kind_seeds (document_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS image_kind_seeds`.execute(db);
    await sql`DROP TABLE IF EXISTS image_kind_seed_sets`.execute(db);
}

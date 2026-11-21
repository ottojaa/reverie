import { Kysely, sql } from 'kysely';

/**
 * Near-duplicate detection: the stored pairs, which images were scanned for them, and the pairs the owner said are not duplicates.
 *
 * up():
 *  1. `duplicate_edges`: one row per pair of near-identical images (`doc_a < doc_b`, so a pair is stored once), with the cosine
 *     similarity of their image embeddings. Groups are not stored: they are built from these rows when read, so trash, restore,
 *     privacy and dismissals never leave a stale group behind. Both ends cascade with the document.
 *  2. `document_duplicate_scans`: an image has been scanned, and with which similarity threshold. A scan made at a higher threshold than the
 *     one configured now missed pairs, so the backfill scans that image again.
 *  3. `duplicate_dismissals`: pairs the owner marked "not duplicates"; they are never grouped again. Cascades with the user and the documents.
 *
 * Nothing in running code that predates this migration reads them, so it can be deployed ahead of the code that fills them.
 *
 * down(): drops all three. Edges and scans are derived data (the backfill rebuilds them); dismissals are the owner's decisions and are lost.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        CREATE TABLE duplicate_edges (
            doc_a uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            doc_b uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            similarity double precision NOT NULL,
            PRIMARY KEY (doc_a, doc_b),
            CHECK (doc_a < doc_b)
        )
    `.execute(db);
    await sql`CREATE INDEX duplicate_edges_doc_b_idx ON duplicate_edges (doc_b)`.execute(db);

    await sql`
        CREATE TABLE document_duplicate_scans (
            document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
            threshold double precision NOT NULL,
            scanned_at timestamptz NOT NULL DEFAULT now()
        )
    `.execute(db);

    await sql`
        CREATE TABLE duplicate_dismissals (
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            doc_a uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            doc_b uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (doc_a, doc_b),
            CHECK (doc_a < doc_b)
        )
    `.execute(db);
    await sql`CREATE INDEX duplicate_dismissals_doc_b_idx ON duplicate_dismissals (doc_b)`.execute(db);
    await sql`CREATE INDEX duplicate_dismissals_user_idx ON duplicate_dismissals (user_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS duplicate_dismissals`.execute(db);
    await sql`DROP TABLE IF EXISTS document_duplicate_scans`.execute(db);
    await sql`DROP TABLE IF EXISTS duplicate_edges`.execute(db);
}

import { Kysely, sql } from 'kysely';

/**
 * Local embeddings for semantic search, stored in Postgres with pgvector. Nothing reads these tables yet:
 * search ranking is unchanged, and running code that predates this migration ignores them.
 *
 * up():
 *  1. `CREATE EXTENSION vector`. It is NOT guarded: on a Postgres without pgvector (the old `postgres:16-alpine`
 *     image) the migration fails loudly rather than leaving a half-built schema. The compose files build the
 *     Postgres image from docker/postgres, which has pgvector.
 *  2. `document_text_embeddings`: one row per chunk of a document's text (summary + OCR text), 1024 dimensions
 *     (BAAI/bge-m3), with the model name and version it came from and a hash of the embedded text.
 *  3. `document_image_embeddings`: one row per image document, 1152 dimensions (SigLIP2 so400m), with the model and
 *     version and a hash of the thumbnail rendition it came from.
 *  Both reference documents ON DELETE CASCADE, so purging a document (a DELETE FROM documents) removes its
 *  embeddings. Both have an HNSW index on cosine distance.
 *
 * down(): drops both tables, then the extension. The embeddings are derived data: after a restore or a down/up
 * cycle the backfill (a job queued at backend start) rebuilds them.
 *
 * Changing a model's dimensions later needs a new migration: the vector columns have a fixed size.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`CREATE EXTENSION vector`.execute(db);

    await sql`
        CREATE TABLE document_text_embeddings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            chunk_index integer NOT NULL,
            char_start integer NOT NULL,
            char_end integer NOT NULL,
            content_hash text NOT NULL,
            model text NOT NULL,
            model_version text NOT NULL,
            embedding vector(1024) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (document_id, chunk_index)
        )
    `.execute(db);
    await sql`CREATE INDEX document_text_embeddings_hnsw ON document_text_embeddings USING hnsw (embedding vector_cosine_ops)`.execute(db);

    await sql`
        CREATE TABLE document_image_embeddings (
            document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
            content_hash text NOT NULL,
            model text NOT NULL,
            model_version text NOT NULL,
            embedding vector(1152) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `.execute(db);
    await sql`CREATE INDEX document_image_embeddings_hnsw ON document_image_embeddings USING hnsw (embedding vector_cosine_ops)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS document_image_embeddings`.execute(db);
    await sql`DROP TABLE IF EXISTS document_text_embeddings`.execute(db);
    await sql`DROP EXTENSION IF EXISTS vector`.execute(db);
}

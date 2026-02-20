import { Kysely, sql } from 'kysely';

/**
 * Migration: Add unified search_vector to documents table
 *
 * Aggregates all searchable metadata into a single weighted tsvector on the
 * documents table so that natural-language queries like "spain 2024" match
 * photos with country=Spain and taken_at in 2024.
 *
 * Weighted tsvector layout:
 *   A - LLM title (highest signal)
 *   B - Tags, entities, document category, filename
 *   C - Photo city, country, date tokens (year + month names)
 *   D - OCR raw text, LLM summary (bulk content)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('documents')
        .addColumn('search_vector', sql`tsvector`)
        .execute();

    await sql`CREATE INDEX idx_documents_search_vector ON documents USING GIN(search_vector)`.execute(db);

    await sql`
    CREATE OR REPLACE FUNCTION rebuild_document_search_vector(doc_id uuid)
    RETURNS void AS $$
    DECLARE
        v_filename       text;
        v_category       text;
        v_ocr_text       text;
        v_llm_title      text;
        v_llm_summary    text;
        v_city           text;
        v_country        text;
        v_taken_at       timestamptz;
        v_extracted_date date;
        v_tags_text      text;
        v_date_tokens    text := '';
        v_vec            tsvector;
    BEGIN
        SELECT d.original_filename, d.document_category, d.extracted_date
          INTO v_filename, v_category, v_extracted_date
          FROM documents d WHERE d.id = doc_id;

        IF NOT FOUND THEN RETURN; END IF;

        SELECT ocr.raw_text INTO v_ocr_text
          FROM ocr_results ocr WHERE ocr.document_id = doc_id;

        SELECT llm.metadata->>'title', llm.summary
          INTO v_llm_title, v_llm_summary
          FROM llm_results llm WHERE llm.document_id = doc_id;

        SELECT pm.city, pm.country, pm.taken_at
          INTO v_city, v_country, v_taken_at
          FROM photo_metadata pm WHERE pm.document_id = doc_id;

        SELECT string_agg(dt.tag, ' ')
          INTO v_tags_text
          FROM document_tags dt WHERE dt.document_id = doc_id;

        -- Build date tokens from taken_at or extracted_date
        IF v_taken_at IS NOT NULL THEN
            v_date_tokens := to_char(v_taken_at, 'YYYY')
                || ' ' || to_char(v_taken_at, 'FMMonth')
                || ' ' || to_char(v_taken_at, 'FMMonth YYYY');
        ELSIF v_extracted_date IS NOT NULL THEN
            v_date_tokens := to_char(v_extracted_date, 'YYYY')
                || ' ' || to_char(v_extracted_date, 'FMMonth')
                || ' ' || to_char(v_extracted_date, 'FMMonth YYYY');
        END IF;

        v_vec :=
            setweight(to_tsvector('english', COALESCE(v_llm_title, '')), 'A')
            || setweight(to_tsvector('english',
                COALESCE(v_tags_text, '')
                || ' ' || COALESCE(v_category, '')
                || ' ' || COALESCE(v_filename, '')
            ), 'B')
            || setweight(to_tsvector('english',
                COALESCE(v_city, '')
                || ' ' || COALESCE(v_country, '')
                || ' ' || v_date_tokens
            ), 'C')
            || setweight(to_tsvector('english',
                COALESCE(v_ocr_text, '')
                || ' ' || COALESCE(v_llm_summary, '')
            ), 'D');

        UPDATE documents SET search_vector = v_vec WHERE id = doc_id;
    END;
    $$ LANGUAGE plpgsql;
    `.execute(db);

    // Backfill existing documents
    await sql`
    DO $$
    DECLARE
        doc_row RECORD;
    BEGIN
        FOR doc_row IN SELECT id FROM documents LOOP
            PERFORM rebuild_document_search_vector(doc_row.id);
        END LOOP;
    END;
    $$;
    `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP FUNCTION IF EXISTS rebuild_document_search_vector(uuid)`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_documents_search_vector`.execute(db);
    await db.schema.alterTable('documents').dropColumn('search_vector').execute();
}

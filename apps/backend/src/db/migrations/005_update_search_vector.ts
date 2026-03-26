import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema';

/**
 * Update rebuild_document_search_vector to include mime_type tokens and file extension.
 *
 * This ensures free-text queries like "video", "pdf", "mp4" match documents
 * by their MIME type and file extension, not just filename/OCR content.
 */
export async function up(db: Kysely<Database>): Promise<void> {
    await sql`
    CREATE OR REPLACE FUNCTION rebuild_document_search_vector(doc_id uuid)
    RETURNS void AS $$
    DECLARE
        v_filename       text;
        v_category       text;
        v_mime_type      text;
        v_ocr_text       text;
        v_llm_title      text;
        v_llm_summary    text;
        v_city           text;
        v_country        text;
        v_taken_at       timestamptz;
        v_extracted_date date;
        v_tags_text      text;
        v_date_tokens    text := '';
        v_mime_tokens    text := '';
        v_file_ext       text := '';
        v_vec            tsvector;
    BEGIN
        SELECT d.original_filename, d.document_category, d.extracted_date, d.mime_type
          INTO v_filename, v_category, v_extracted_date, v_mime_type
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

        IF v_taken_at IS NOT NULL THEN
            v_date_tokens := to_char(v_taken_at, 'YYYY')
                || ' ' || to_char(v_taken_at, 'FMMonth')
                || ' ' || to_char(v_taken_at, 'FMMonth YYYY');
        ELSIF v_extracted_date IS NOT NULL THEN
            v_date_tokens := to_char(v_extracted_date, 'YYYY')
                || ' ' || to_char(v_extracted_date, 'FMMonth')
                || ' ' || to_char(v_extracted_date, 'FMMonth YYYY');
        END IF;

        -- Derive searchable tokens from mime type (e.g. 'video/mp4' -> 'video mp4')
        IF v_mime_type IS NOT NULL THEN
            v_mime_tokens := replace(v_mime_type, '/', ' ');
            -- Also strip 'application' and 'image' prefixes so 'pdf' alone matches
            v_mime_tokens := regexp_replace(v_mime_tokens, '\bapplication\b', '', 'g');
            v_mime_tokens := regexp_replace(v_mime_tokens, '\bimage\b', '', 'g');
            v_mime_tokens := trim(v_mime_tokens);
        END IF;

        -- Extract file extension from filename (e.g. 'report.pdf' -> 'pdf')
        IF v_filename IS NOT NULL AND position('.' IN v_filename) > 0 THEN
            v_file_ext := lower(reverse(split_part(reverse(v_filename), '.', 1)));
        END IF;

        v_vec :=
            setweight(to_tsvector('english', COALESCE(v_llm_title, '')), 'A')
            || setweight(to_tsvector('simple',
                COALESCE(v_tags_text, '')
                || ' ' || COALESCE(v_category, '')
                || ' ' || COALESCE(v_filename, '')
                || ' ' || COALESCE(v_mime_tokens, '')
                || ' ' || COALESCE(v_file_ext, '')
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

    // Rebuild search vectors for all existing documents
    await sql`SELECT rebuild_document_search_vector(id) FROM documents`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
    // Restore original function (without mime/extension tokens)
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

    await sql`SELECT rebuild_document_search_vector(id) FROM documents`.execute(db);
}

import { Kysely, sql } from 'kysely';

/**
 * Migration: Add text detection columns for OCR pipeline (Plan 05)
 *
 * Adds columns to track:
 * - Whether a document contains meaningful text (vs photos/graphics)
 * - Text density metric for detection
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    // Add has_meaningful_text column to documents table
    await db.schema
        .alterTable('documents')
        .addColumn('has_meaningful_text', 'boolean', (col) => col.defaultTo(true))
        .execute();

    // Add text_density and has_meaningful_text columns to ocr_results table
    await db.schema
        .alterTable('ocr_results')
        .addColumn('text_density', 'real')
        .execute();

    await db.schema
        .alterTable('ocr_results')
        .addColumn('has_meaningful_text', 'boolean', (col) => col.defaultTo(true))
        .execute();

    // Create index for filtering documents with/without text
    await db.schema.createIndex('idx_documents_has_text').on('documents').column('has_meaningful_text').execute();

    // Update the text_vector trigger to only index documents with meaningful text
    await sql`
    CREATE OR REPLACE FUNCTION update_ocr_text_vector()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.has_meaningful_text = true THEN
        NEW.text_vector := to_tsvector('english', COALESCE(NEW.raw_text, ''));
      ELSE
        NEW.text_vector := NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    // Drop index
    await db.schema.dropIndex('idx_documents_has_text').ifExists().execute();

    // Remove columns from ocr_results
    await db.schema.alterTable('ocr_results').dropColumn('has_meaningful_text').execute();
    await db.schema.alterTable('ocr_results').dropColumn('text_density').execute();

    // Remove column from documents
    await db.schema.alterTable('documents').dropColumn('has_meaningful_text').execute();

    // Restore original trigger function
    await sql`
    CREATE OR REPLACE FUNCTION update_ocr_text_vector()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.text_vector := to_tsvector('english', COALESCE(NEW.raw_text, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);
}

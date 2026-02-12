import { type Kysely, sql } from 'kysely';

/**
 * Add ocr_engine column to ocr_results table.
 * Stores the OCR engine name and version used to produce each result,
 * e.g. "paddleocr/PP-OCRv4" or "tesseract/5.x-fin+eng".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('ocr_results')
        .addColumn('ocr_engine', 'varchar(100)', (col) => col.defaultTo(sql`'unknown'`))
        .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('ocr_results').dropColumn('ocr_engine').execute();
}

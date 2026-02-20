import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';

/**
 * Rebuild the unified search_vector for a single document.
 *
 * Calls the PostgreSQL function `rebuild_document_search_vector(uuid)` which
 * aggregates OCR text, LLM title/summary, photo metadata (city, country,
 * date tokens), tags, filename, and category into a weighted tsvector on the
 * documents table.
 *
 * Call this after any pipeline stage that changes searchable content:
 * - After OCR + EXIF extraction
 * - After LLM processing (text summary or vision describe)
 * - After tag changes
 */
export async function rebuildSearchVector(db: Kysely<Database>, documentId: string): Promise<void> {
    await sql`SELECT rebuild_document_search_vector(${documentId}::uuid)`.execute(db);
}

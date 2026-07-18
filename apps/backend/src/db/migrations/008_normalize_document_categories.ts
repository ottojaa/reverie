import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Normalize legacy document categories to the current DocumentCategoryEnum
 * vocabulary (the LLM pipeline stopped writing the legacy values):
 * - transaction_receipt -> receipt
 * - stock_overview / stock_split / dividend_statement -> stock_statement
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    const updated = await sql<{ id: string }>`
        UPDATE documents
        SET document_category = CASE document_category
            WHEN 'transaction_receipt' THEN 'receipt'
            ELSE 'stock_statement'
        END
        WHERE document_category IN ('transaction_receipt', 'stock_overview', 'stock_split', 'dividend_statement')
        RETURNING id
    `.execute(db);

    if (updated.rows.length === 0) return;

    const ids = updated.rows.map((row) => row.id);

    // Separate statement on purpose: search_vector embeds the category at weight B,
    // and a data-modifying CTE would make rebuild_document_search_vector read the
    // pre-UPDATE row snapshot.
    await sql`SELECT rebuild_document_search_vector(id) FROM unnest(${ids}::uuid[]) AS t(id)`.execute(db);
}

export async function down(): Promise<void> {}

import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`UPDATE documents SET document_category = 'bank_statement' WHERE document_category = 'securities_statement'`.execute(db);
    await sql`UPDATE documents SET document_category = 'stock_statement' WHERE document_category = 'statement'`.execute(db);
    await sql`UPDATE documents SET document_category = 'bank_statement' WHERE document_category = 'tax_document'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {}

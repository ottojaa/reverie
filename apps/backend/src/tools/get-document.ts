import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../db/kysely';
import { documentJoins } from '../search';
import { DOCUMENT_ROW_COLUMNS, loadTags, toDocumentRow, type DocumentRow } from './document-output';
import { withholdsImageContent } from './photo';
import { defineTool, ToolError } from './types';
import { loadVisibility, visibleDocuments } from './visibility';
import { formatDateOnly } from '../utils/date';

const DEFAULT_TEXT_LENGTH = 2000;
const MAX_TEXT_LENGTH = 8000;

const getDocumentSchema = z.object({
    document_id: z.string().uuid(),
    text_offset: z.number().int().min(0).default(0).describe('Character to start the OCR text at, to read a long text in pages'),
    text_length: z.number().int().min(1).max(MAX_TEXT_LENGTH).default(DEFAULT_TEXT_LENGTH),
});

interface TextSlice {
    content: string;
    offset: number;
    total_length: number;
    next_offset: number | null;
}

async function loadTextSlice(documentId: string, offset: number, length: number): Promise<TextSlice | null> {
    const row = await db
        .selectFrom('ocr_results')
        .select([sql<string>`substr(raw_text, ${offset + 1}, ${length})`.as('content'), sql<number>`char_length(raw_text)`.as('total')])
        .where('document_id', '=', documentId)
        .executeTakeFirst();

    if (!row) return null;

    const total = Number(row.total);
    const end = offset + Array.from(row.content).length;

    return { content: row.content, offset, total_length: total, next_offset: end < total ? end : null };
}

async function loadEntities(documentId: string) {
    const llm = await db.selectFrom('llm_results').select(['summary', 'metadata']).where('document_id', '=', documentId).executeTakeFirst();
    const metadata = llm?.metadata;
    const entities = metadata && 'entities' in metadata ? metadata.entities : [];

    return {
        summary: llm?.summary ?? null,
        title: metadata && 'title' in metadata ? (metadata.title ?? null) : null,
        entities: entities.map((entity) => ({ type: entity.type, name: entity.canonical_name })),
    };
}

export const getDocument = defineTool({
    name: 'get_document',
    description:
        'Details of one document: title, summary, entities, dates, place, tags, and its OCR text in pages (text_offset, text_length; next_offset continues). For photos only filename, dates, place and tags.',
    access: 'read',
    inputSchema: getDocumentSchema,
    handler: async (input, ctx) => {
        const vis = await loadVisibility(ctx.user.id);
        const visible = await visibleDocuments(db, vis).select('documents.id').where('documents.id', '=', input.document_id).executeTakeFirst();

        if (!visible) throw new ToolError('Document not found: ' + input.document_id);

        const source = await documentJoins()
            .select([...DOCUMENT_ROW_COLUMNS, 'd.size_bytes', 'd.created_at'])
            .where('d.id', '=', input.document_id)
            .executeTakeFirstOrThrow();
        const tags = await loadTags([source.id]);
        const row: DocumentRow & { size_bytes: number; uploaded: string | null } = {
            ...toDocumentRow(source, tags.get(source.id) ?? []),
            size_bytes: Number(source.size_bytes),
            uploaded: formatDateOnly(source.created_at),
        };

        // Photos stop here: everything below is derived from what the picture shows.
        if (withholdsImageContent(source)) return { ...row, content_withheld: true };

        const [text, llm] = await Promise.all([loadTextSlice(source.id, input.text_offset, input.text_length), loadEntities(source.id)]);

        return { ...row, ...llm, text };
    },
});

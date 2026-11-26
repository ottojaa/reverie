import type { DocumentKind, DocumentSummaryResponse } from '@reverie/shared';
import { sql, type ExpressionBuilder } from 'kysely';
import { db } from '../db/kysely.js';
import type { Database } from '../db/schema.js';
import { applyDocumentListFilters, isOfKind, TAKEN_OR_CREATED_SQL, type DocumentListFilters } from './document-list-filters.js';

export const TOP_TYPES = 4;
export const KINDS: DocumentKind[] = ['image', 'video', 'file'];

/** The type a file shows as: the lowercase extension of its name ('' when it has none, and then it counts toward no type). */
export const FILE_TYPE_SQL = sql<string>`coalesce(substring(lower(original_filename) from '\\.([^.]+)$'), '')`;

export function totalsOf(eb: ExpressionBuilder<Database, 'documents'>, kind: DocumentKind) {
    return [
        eb.fn
            .countAll<string>()
            .filterWhere(isOfKind('mime_type', kind))
            .as(kind + '_count'),
        eb.fn.coalesce(eb.fn.sum<string>('size_bytes').filterWhere(isOfKind('mime_type', kind)), sql<string>`0`).as(kind + '_bytes'),
    ];
}

/**
 * What the documents the filters select hold, per kind: how many and how many bytes, and the most common file types.
 * Both queries go through applyDocumentListFilters (without a kind), so the scope matches GET /documents exactly.
 */
export async function summariseDocuments(filters: Omit<DocumentListFilters, 'kind'>): Promise<DocumentSummaryResponse> {
    const totals = applyDocumentListFilters(
        db.selectFrom('documents').select((eb) => KINDS.flatMap((kind) => totalsOf(eb, kind))),
        filters,
    ).executeTakeFirstOrThrow();
    const types = applyDocumentListFilters(db.selectFrom('documents').select([FILE_TYPE_SQL.as('ext'), (eb) => eb.fn.countAll<string>().as('count')]), {
        ...filters,
        kind: 'file',
    })
        .where(FILE_TYPE_SQL, '<>', '')
        .groupBy('ext')
        .orderBy('count', 'desc')
        .orderBy('ext')
        .limit(TOP_TYPES)
        .execute();
    const [row, topTypes] = await Promise.all([totals, types]);

    return toSummary(row, topTypes);
}

/** The first and last day the scope's photos and videos were taken (upload time without one); null when it has none. */
export async function loadMediaDates(filters: Omit<DocumentListFilters, 'kind' | 'media'>): Promise<DocumentSummaryResponse['media_dates']> {
    const range = db
        .selectFrom('documents')
        .select([sql<Date | null>`min(${TAKEN_OR_CREATED_SQL})`.as('first'), sql<Date | null>`max(${TAKEN_OR_CREATED_SQL})`.as('last')]);
    const { first, last } = await applyDocumentListFilters(range, { ...filters, media: true }).executeTakeFirstOrThrow();

    if (!first || !last) return null;

    return { first: first.toISOString(), last: last.toISOString() };
}

/** One row of totalsOf's columns: `<kind>_count` and `<kind>_bytes`, as numbers or the strings the driver returns. */
type TotalsRow = Record<string, string | number | null>;

export function toSummary(row: TotalsRow, topTypes: Array<{ ext: string; count: string | number }>): DocumentSummaryResponse {
    return {
        image: { count: Number(row.image_count), bytes: Number(row.image_bytes) },
        video: { count: Number(row.video_count), bytes: Number(row.video_bytes) },
        file: {
            count: Number(row.file_count),
            bytes: Number(row.file_bytes),
            top_types: topTypes.map((type) => ({ ext: type.ext, count: Number(type.count) })),
        },
    };
}

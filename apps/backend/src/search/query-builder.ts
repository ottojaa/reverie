import { sql, type SelectQueryBuilder, type SqlBool } from 'kysely';
import type { ParsedQuery, DateRange, SortBy } from '@reverie/shared';
import type { Database } from '../db/schema';
import { resolveRelativeDate } from './query-parser';

/**
 * Query Builder for Advanced Search
 *
 * Converts ParsedQuery into efficient Kysely SQL queries using PostgreSQL full-text search.
 */

// Mime type mappings for format filter
const FORMAT_TO_MIME: Record<string, string[]> = {
    pdf: ['application/pdf'],
    jpg: ['image/jpeg'],
    jpeg: ['image/jpeg'],
    png: ['image/png'],
    gif: ['image/gif'],
    webp: ['image/webp'],
    heic: ['image/heic'],
    heif: ['image/heif'],
    tiff: ['image/tiff'],
    tif: ['image/tiff'],
    bmp: ['image/bmp'],
    svg: ['image/svg+xml'],
};

// Type to document category mappings
const TYPE_TO_CATEGORIES: Record<string, string[]> = {
    photo: ['photo', 'other'], // Photos are typically 'other' category without meaningful text
    document: ['stock_overview', 'stock_split', 'dividend_statement', 'transaction_receipt', 'other'],
    receipt: ['transaction_receipt'],
    screenshot: ['screenshot'],
};

export interface SearchQueryOptions {
    limit: number;
    offset: number;
    sortBy: SortBy;
    sortOrder: 'asc' | 'desc';
}

// Extended database type with aliases
type SearchDatabase = Database & {
    d: Database['documents'];
    f: Database['folders'];
    ocr: Database['ocr_results'];
};

type SearchQueryBase = SelectQueryBuilder<SearchDatabase, 'd' | 'f' | 'ocr', object>;

/**
 * Apply date range filter to query
 */
function applyDateRangeFilter<T extends SearchQueryBase>(
    query: T,
    dateRange: DateRange | undefined,
    column: 'd.created_at' | 'd.extracted_date',
): T {
    if (!dateRange) return query;

    let start = dateRange.start;
    let end = dateRange.end;

    // Resolve relative dates
    if (dateRange.relative) {
        const resolved = resolveRelativeDate(dateRange.relative);
        start = resolved.start;
        end = resolved.end;
    }

    if (start) {
        query = query.where(column, '>=', start) as T;
    }
    if (end) {
        query = query.where(column, '<=', end) as T;
    }

    return query;
}

/**
 * Apply negation filters to query
 */
function applyNegations<T extends SearchQueryBase>(query: T, negations: Partial<ParsedQuery> | undefined): T {
    if (!negations) return query;

    // Negated types
    if (negations.types?.length) {
        const allNegatedCategories = negations.types.flatMap((t) => TYPE_TO_CATEGORIES[t] || [t]);
        query = query.where('d.document_category', 'not in', allNegatedCategories) as T;
    }

    // Negated formats
    if (negations.formats?.length) {
        const allNegatedMimes = negations.formats.flatMap((f) => FORMAT_TO_MIME[f.toLowerCase()] || [`application/${f}`]);
        query = query.where('d.mime_type', 'not in', allNegatedMimes) as T;
    }

    // Negated has:text
    if (negations.hasText === true) {
        query = query.where('d.has_meaningful_text', '=', false) as T;
    }

    // Negated has:summary
    if (negations.hasSummary === true) {
        query = query.where('d.llm_summary', 'is', null) as T;
    }

    // Negated has:thumbnail
    if (negations.hasThumbnail === true) {
        query = query.where('d.thumbnail_paths', 'is', null) as T;
    }

    // Negated tags
    if (negations.tags?.length) {
        const tagsArray = negations.tags;
        query = query.where(sql<SqlBool>`d.id NOT IN (SELECT document_id FROM document_tags WHERE tag = ANY(ARRAY[${sql.join(tagsArray.map((t) => sql`${t}`), sql`, `)}]::text[]))`) as T;
    }

    // Negated categories
    if (negations.categories?.length) {
        query = query.where('d.document_category', 'not in', negations.categories) as T;
    }

    // Negated folders
    if (negations.folders?.length) {
        query = query.where((eb) => {
            const conditions = negations.folders!.map((folder) => {
                if (folder.startsWith('/')) {
                    return eb('f.path' as any, '!=', folder);
                }
                return sql<SqlBool>`f.path NOT ILIKE ${`%${folder}%`}`;
            });
            return eb.and(conditions);
        }) as T;
    }

    return query;
}

/**
 * Build the main search query from ParsedQuery
 */
export function buildSearchQuery(
    baseQuery: SearchQueryBase,
    parsed: ParsedQuery,
    userId: string,
    options: SearchQueryOptions,
): SearchQueryBase {
    let query = baseQuery;

    // Always filter by user
    query = query.where('d.user_id', '=', userId);

    // Full-text search
    if (parsed.fullText) {
        const tsQuery = sql`plainto_tsquery('english', ${parsed.fullText})`;

        // Determine search scope
        if (parsed.searchScope === 'filename') {
            query = query.where(sql<SqlBool>`d.original_filename ILIKE ${'%' + parsed.fullText + '%'}`);
        } else if (parsed.searchScope === 'content') {
            query = query.where(sql<SqlBool>`ocr.text_vector @@ ${tsQuery}`);
        } else if (parsed.searchScope === 'summary') {
            query = query.where(sql<SqlBool>`d.llm_summary ILIKE ${'%' + parsed.fullText + '%'}`);
        } else {
            // Search all: filename, OCR text, LLM summary
            query = query.where((eb) =>
                eb.or([
                    sql<SqlBool>`d.original_filename ILIKE ${'%' + parsed.fullText + '%'}`,
                    sql<SqlBool>`ocr.text_vector @@ ${tsQuery}`,
                    sql<SqlBool>`d.llm_summary ILIKE ${'%' + parsed.fullText + '%'}`,
                ]),
            );
        }
    }

    // Type filter (photo, document, receipt, screenshot)
    if (parsed.types?.length) {
        const allCategories = parsed.types.flatMap((t) => TYPE_TO_CATEGORIES[t] || [t]);
        const uniqueCategories = [...new Set(allCategories)];

        // For "photo" type, also filter by has_meaningful_text = false
        if (parsed.types.includes('photo') && !parsed.types.some((t) => t !== 'photo')) {
            query = query.where('d.has_meaningful_text', '=', false);
        } else if (uniqueCategories.length > 0) {
            query = query.where((eb) =>
                eb.or([eb('d.document_category' as any, 'in', uniqueCategories), ...(parsed.types!.includes('photo') ? [eb('d.has_meaningful_text' as any, '=', false)] : [])]),
            );
        }
    }

    // Format filter (pdf, jpg, png)
    if (parsed.formats?.length) {
        const allMimes = parsed.formats.flatMap((f) => FORMAT_TO_MIME[f.toLowerCase()] || [`application/${f}`]);
        const uniqueMimes = [...new Set(allMimes)];
        query = query.where('d.mime_type', 'in', uniqueMimes);
    }

    // Category filter (stock_overview, transaction_receipt, etc.)
    if (parsed.categories?.length) {
        query = query.where('d.document_category', 'in', parsed.categories);
    }

    // Upload date filter
    query = applyDateRangeFilter(query, parsed.uploadedRange, 'd.created_at');

    // Extracted date filter
    query = applyDateRangeFilter(query, parsed.extractedDateRange, 'd.extracted_date');

    // Folder filter
    if (parsed.folders?.length) {
        query = query.where((eb) => {
            const conditions = parsed.folders!.map((folder) => {
                if (folder.startsWith('/')) {
                    // Exact path match
                    return eb('f.path' as any, '=', folder);
                }
                // Partial match
                return sql<SqlBool>`f.path ILIKE ${'%' + folder + '%'}`;
            });
            return eb.or(conditions);
        });
    }

    // Folder ID filter
    if (parsed.folderIds?.length) {
        query = query.where('d.folder_id', 'in', parsed.folderIds);
    }

    // Has text filter
    if (parsed.hasText !== undefined) {
        query = query.where('d.has_meaningful_text', '=', parsed.hasText);
    }

    // Has summary filter
    if (parsed.hasSummary !== undefined) {
        if (parsed.hasSummary) {
            query = query.where('d.llm_summary', 'is not', null);
        } else {
            query = query.where('d.llm_summary', 'is', null);
        }
    }

    // Has thumbnail filter
    if (parsed.hasThumbnail !== undefined) {
        if (parsed.hasThumbnail) {
            query = query.where('d.thumbnail_paths', 'is not', null);
        } else {
            query = query.where('d.thumbnail_paths', 'is', null);
        }
    }

    // Size filter
    if (parsed.sizeMin !== undefined) {
        query = query.where('d.size_bytes', '>=', parsed.sizeMin);
    }
    if (parsed.sizeMax !== undefined) {
        query = query.where('d.size_bytes', '<=', parsed.sizeMax);
    }

    // Tag filter
    if (parsed.tags?.length) {
        // Document must have ALL specified tags
        for (const tag of parsed.tags) {
            query = query.where(sql<SqlBool>`d.id IN (SELECT document_id FROM document_tags WHERE tag = ${tag})`);
        }
    }

    // Entity filter (search in OCR metadata companies and text)
    if (parsed.entities?.length) {
        query = query.where((eb) => {
            const conditions = parsed.entities!.map((entity) => {
                const tsQuery = sql`to_tsquery('english', ${entity.replace(/\s+/g, ' & ')})`;
                return eb.or([
                    // Check JSONB companies array
                    sql<SqlBool>`ocr.metadata->'companies' ? ${entity}`,
                    // Full-text search in OCR text
                    sql<SqlBool>`ocr.text_vector @@ ${tsQuery}`,
                    // Check LLM metadata key entities
                    sql<SqlBool>`d.llm_metadata->'keyEntities' ? ${entity}`,
                ]);
            });
            return eb.and(conditions);
        });
    }

    // Apply negations
    query = applyNegations(query, parsed.negations);

    // Sorting
    if (options.sortBy === 'relevance' && parsed.fullText) {
        const tsQuery = sql`plainto_tsquery('english', ${parsed.fullText})`;
        // Sort by text search relevance, then by date
        query = query.orderBy(sql`ts_rank(ocr.text_vector, ${tsQuery})`, options.sortOrder === 'desc' ? 'desc' : 'asc').orderBy('d.created_at', 'desc');
    } else if (options.sortBy === 'uploaded') {
        query = query.orderBy('d.created_at', options.sortOrder);
    } else if (options.sortBy === 'date') {
        query = query.orderBy('d.extracted_date', options.sortOrder).orderBy('d.created_at', options.sortOrder);
    } else if (options.sortBy === 'filename') {
        query = query.orderBy('d.original_filename', options.sortOrder);
    } else if (options.sortBy === 'size') {
        query = query.orderBy('d.size_bytes', options.sortOrder);
    } else {
        // Default: newest first
        query = query.orderBy('d.created_at', 'desc');
    }

    // Pagination
    query = query.limit(options.limit).offset(options.offset);

    return query;
}

/**
 * Build the count query (same filters, no pagination)
 */
export function buildCountQuery(
    baseQuery: SelectQueryBuilder<Database & { d: Database['documents']; f: Database['folders']; ocr: Database['ocr_results'] }, 'd' | 'f' | 'ocr', object>,
    parsed: ParsedQuery,
    userId: string,
): SelectQueryBuilder<Database & { d: Database['documents']; f: Database['folders']; ocr: Database['ocr_results'] }, 'd' | 'f' | 'ocr', { count: number }> {
    // Reuse the search query builder but without sorting and pagination
    const query = buildSearchQuery(baseQuery, parsed, userId, {
        limit: 1000000, // Will be ignored
        offset: 0,
        sortBy: 'uploaded',
        sortOrder: 'desc',
    });

    // Replace select with count
    return query.clearSelect().clearOrderBy().clearLimit().clearOffset().select(sql<number>`count(*)::int`.as('count')) as SelectQueryBuilder<
        Database & { d: Database['documents']; f: Database['folders']; ocr: Database['ocr_results'] },
        'd' | 'f' | 'ocr',
        { count: number }
    >;
}

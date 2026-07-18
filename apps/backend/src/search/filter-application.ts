import { TEXT_DOCUMENT_CATEGORIES, type DateRange, type ParsedQuery } from '@reverie/shared';
import { sql, type RawBuilder, type SelectQueryBuilder, type SqlBool } from 'kysely';
import { db } from '../db/kysely';
import type { Database } from '../db/schema';
import { excludePrivateDocuments } from '../services/privacy';
import { resolveRelativeDate } from './query-parser';

/**
 * Filter application for Advanced Search
 *
 * Converts a ParsedQuery into WHERE clauses on the joined documents query.
 * Shared by the main search (query-builder.ts) and faceting (facets.ts):
 * facets pass an `omit` set to count a dimension with every other active
 * filter still applied.
 */

// Extended database type with aliases
export type SearchDatabase = Database & {
    d: Database['documents'];
    f: Database['folders'];
    ocr: Database['ocr_results'];
    llm: Database['llm_results'];
    pm: Database['photo_metadata'];
};

export type SearchQueryBase = SelectQueryBuilder<SearchDatabase, 'd' | 'f' | 'ocr' | 'llm' | 'pm', object>;

/** One filterable dimension of a ParsedQuery (positive and negated filters together). */
export type FilterDimension =
    | 'fullText'
    | 'types'
    | 'formats'
    | 'categories'
    | 'uploaded'
    | 'extractedDate'
    | 'folders'
    | 'hasText'
    | 'hasSummary'
    | 'hasThumbnail'
    | 'size'
    | 'tags'
    | 'entities'
    | 'locations';

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
    mp4: ['video/mp4'],
    mov: ['video/quicktime'],
    webm: ['video/webm'],
    avi: ['video/x-msvideo'],
    mkv: ['video/x-matroska'],
};

// Canonical type token -> document category mappings
const TYPE_TO_CATEGORIES: Record<string, readonly string[]> = {
    photo: ['photo', 'other'], // Photos are typically 'other' category without meaningful text
    document: TEXT_DOCUMENT_CATEGORIES,
    receipt: ['receipt'],
    screenshot: ['screenshot'],
    video: ['video'],
};

/**
 * Build a prefix-aware tsquery so partial words match.
 * "instru" → to_tsquery('english', 'instru:*')
 * "spain 2024" → to_tsquery('english', 'spain:* & 2024:*')
 */
export function buildPrefixTsQuery(text: string): RawBuilder<unknown> | null {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const sanitized = words.map((w) => w.replace(/[&|!():*<>'"\\]/g, '').trim()).filter((w) => w.length > 0);

    if (sanitized.length === 0) {
        return null;
    }

    const prefixExpr = sanitized.map((w) => `${w}:*`).join(' & ');

    return sql`to_tsquery('english', ${prefixExpr})`;
}

/** documents + the joins the search filters/snippets reference. */
export function documentJoins(): SearchQueryBase {
    // Left joins make the joined columns nullable in Kysely's derived type;
    // SearchQueryBase deliberately keeps the plain table types (existing style),
    // hence the cast.
    return db
        .selectFrom('documents as d')
        .leftJoin('folders as f', 'f.id', 'd.folder_id')
        .leftJoin('ocr_results as ocr', 'ocr.document_id', 'd.id')
        .leftJoin('llm_results as llm', 'llm.document_id', 'd.id')
        .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id') as unknown as SearchQueryBase;
}

/**
 * Type filter (photo, document, receipt, screenshot, video). Shared by search
 * and the type facet so a facet count always equals the result count on click.
 */
export function applyTypesFilter(query: SearchQueryBase, types: readonly string[]): SearchQueryBase {
    const allCategories = types.flatMap((t) => TYPE_TO_CATEGORIES[t] || [t]);
    const uniqueCategories = [...new Set(allCategories)];

    if (uniqueCategories.length === 0) return query;

    // Match by document_category, and for "photo" also include has_meaningful_text = false
    // (some image files may have category='other' but no meaningful text)
    if (types.includes('photo')) {
        return query.where((eb) => eb.or([eb('d.document_category' as any, 'in', uniqueCategories), eb('d.has_meaningful_text' as any, '=', false)]));
    }

    return query.where('d.document_category' as any, 'in', uniqueCategories);
}

/**
 * Apply date range filter to query
 */
function applyDateRangeFilter<T extends SearchQueryBase>(query: T, dateRange: DateRange | undefined, column: 'd.created_at' | 'd.extracted_date'): T {
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
 * Apply negation filters to query. A dimension in `omit` skips its negated
 * filters together with its positive ones.
 */
function applyNegations<T extends SearchQueryBase>(query: T, negations: Partial<ParsedQuery> | undefined, omit?: ReadonlySet<FilterDimension>): T {
    if (!negations) return query;

    // Negated types
    if (!omit?.has('types') && negations.types?.length) {
        const allNegatedCategories = negations.types.flatMap((t) => TYPE_TO_CATEGORIES[t] || [t]);
        query = query.where('d.document_category', 'not in', allNegatedCategories) as T;
    }

    // Negated formats
    if (!omit?.has('formats') && negations.formats?.length) {
        const allNegatedMimes = negations.formats.flatMap((f) => FORMAT_TO_MIME[f.toLowerCase()] || [`application/${f}`]);
        query = query.where('d.mime_type', 'not in', allNegatedMimes) as T;
    }

    // Negated has: filters. The parser stores the *effective* boolean under
    // negations (`-has:text` -> negations.hasText === false), so apply the
    // stored value directly rather than checking for `=== true` (which can
    // never occur and previously made `-has:*` a silent no-op).
    if (!omit?.has('hasText') && negations.hasText !== undefined) {
        query = query.where('d.has_meaningful_text', '=', negations.hasText) as T;
    }

    if (!omit?.has('hasSummary') && negations.hasSummary !== undefined) {
        query = query.where('llm.summary' as any, negations.hasSummary ? 'is not' : 'is', null) as T;
    }

    if (!omit?.has('hasThumbnail') && negations.hasThumbnail !== undefined) {
        query = query.where('d.thumbnail_paths', negations.hasThumbnail ? 'is not' : 'is', null) as T;
    }

    // Negated tags
    if (!omit?.has('tags') && negations.tags?.length) {
        const tagsArray = negations.tags;
        query = query.where(
            sql<SqlBool>`d.id NOT IN (SELECT document_id FROM document_tags WHERE tag = ANY(ARRAY[${sql.join(
                tagsArray.map((t) => sql`${t}`),
                sql`, `,
            )}]::text[]))`,
        ) as T;
    }

    // Negated categories
    if (!omit?.has('categories') && negations.categories?.length) {
        query = query.where('d.document_category', 'not in', negations.categories) as T;
    }

    // Negated folders
    if (!omit?.has('folders') && negations.folders?.length) {
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
 * Apply all ParsedQuery filters (plus user scoping and privacy exclusion) to a
 * documents query. Dimensions listed in `omit` are skipped entirely — positive
 * and negated filters alike. User scoping and privacy are never omittable.
 */
export function applySearchFilters(
    query: SearchQueryBase,
    parsed: ParsedQuery,
    userId: string,
    privateFolderIds: string[],
    omit?: ReadonlySet<FilterDimension>,
): SearchQueryBase {
    // Always filter by user
    query = query.where('d.user_id', '=', userId);
    query = excludePrivateDocuments(query, privateFolderIds, 'd.');

    // Full-text search
    if (!omit?.has('fullText') && parsed.fullText) {
        const tsQuery = buildPrefixTsQuery(parsed.fullText);

        // Determine search scope
        if (parsed.searchScope === 'filename') {
            query = query.where(sql<SqlBool>`d.original_filename ILIKE ${'%' + parsed.fullText + '%'}`);
        } else if (parsed.searchScope === 'content') {
            if (tsQuery) query = query.where(sql<SqlBool>`d.search_vector @@ ${tsQuery}`);
        } else if (parsed.searchScope === 'summary') {
            query = query.where(sql<SqlBool>`llm.summary ILIKE ${'%' + parsed.fullText + '%'}`);
        } else if (tsQuery) {
            // Unified search vector includes filename, OCR text, LLM data, photo metadata, tags
            query = query.where(sql<SqlBool>`d.search_vector @@ ${tsQuery}`);
        }
    }

    // Type filter (photo, document, receipt, screenshot, video)
    if (!omit?.has('types') && parsed.types?.length) {
        query = applyTypesFilter(query, parsed.types);
    }

    // Format filter (pdf, jpg, png)
    if (!omit?.has('formats') && parsed.formats?.length) {
        const allMimes = parsed.formats.flatMap((f) => FORMAT_TO_MIME[f.toLowerCase()] || [`application/${f}`]);
        const uniqueMimes = [...new Set(allMimes)];
        query = query.where('d.mime_type', 'in', uniqueMimes);
    }

    // Category filter (stock_statement, receipt, etc.)
    if (!omit?.has('categories') && parsed.categories?.length) {
        query = query.where('d.document_category', 'in', parsed.categories);
    }

    // Upload date filter
    if (!omit?.has('uploaded')) {
        query = applyDateRangeFilter(query, parsed.uploadedRange, 'd.created_at');
    }

    // Extracted date filter
    if (!omit?.has('extractedDate')) {
        query = applyDateRangeFilter(query, parsed.extractedDateRange, 'd.extracted_date');
    }

    // Folder filter (paths and ids share the dimension)
    if (!omit?.has('folders') && parsed.folders?.length) {
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

    if (!omit?.has('folders') && parsed.folderIds?.length) {
        query = query.where('d.folder_id', 'in', parsed.folderIds);
    }

    // Has text filter
    if (!omit?.has('hasText') && parsed.hasText !== undefined) {
        query = query.where('d.has_meaningful_text', '=', parsed.hasText);
    }

    // Has summary filter
    if (!omit?.has('hasSummary') && parsed.hasSummary !== undefined) {
        query = query.where('llm.summary' as any, parsed.hasSummary ? 'is not' : 'is', null);
    }

    // Has thumbnail filter
    if (!omit?.has('hasThumbnail') && parsed.hasThumbnail !== undefined) {
        query = query.where('d.thumbnail_paths', parsed.hasThumbnail ? 'is not' : 'is', null);
    }

    // Size filter
    if (!omit?.has('size') && parsed.sizeMin !== undefined) {
        query = query.where('d.size_bytes', '>=', parsed.sizeMin);
    }

    if (!omit?.has('size') && parsed.sizeMax !== undefined) {
        query = query.where('d.size_bytes', '<=', parsed.sizeMax);
    }

    // Tag filter
    if (!omit?.has('tags') && parsed.tags?.length) {
        // Document must have ALL specified tags
        for (const tag of parsed.tags) {
            query = query.where(sql<SqlBool>`d.id IN (SELECT document_id FROM document_tags WHERE tag = ${tag})`);
        }
    }

    // Entity filter: match the LLM-extracted entities (jsonb containment on the
    // real 'entities' key) or the full-text vector (which includes tags + OCR text).
    if (!omit?.has('entities') && parsed.entities?.length) {
        query = query.where((eb) => {
            const conditions = parsed.entities!.map((entity) => {
                const tsQuery = sql`to_tsquery('english', ${entity.replace(/\s+/g, ' & ')})`;
                const containment = JSON.stringify([{ canonical_name: entity }]);

                return eb.or([sql<SqlBool>`d.search_vector @@ ${tsQuery}`, sql<SqlBool>`llm.metadata->'entities' @> ${containment}::jsonb`]);
            });

            return eb.and(conditions);
        });
    }

    // Location filter (matches city or country in photo_metadata)
    if (!omit?.has('locations') && parsed.locations?.length) {
        query = query.where((eb) => {
            const conditions = parsed.locations!.map((loc) =>
                eb.or([sql<SqlBool>`pm.city ILIKE ${'%' + loc + '%'}`, sql<SqlBool>`pm.country ILIKE ${'%' + loc + '%'}`]),
            );

            return eb.and(conditions);
        });
    }

    // Apply negations
    return applyNegations(query, parsed.negations, omit);
}

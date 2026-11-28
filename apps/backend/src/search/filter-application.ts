import { TEXT_DOCUMENT_CATEGORIES, type DateRange, type ParsedQuery } from '@reverie/shared';
import { sql, type ExpressionBuilder, type RawBuilder, type SelectQueryBuilder, type SqlBool } from 'kysely';
import { db } from '../db/kysely';
import type { Database } from '../db/schema';
import { inNamedFoldersSql, outsideNamedFoldersSql, withinFolderSql } from '../services/folders/scope';
import { isMediaSql, isOfKind } from '../services/document-list-filters';
import { excludePrivateDocuments, excludeTrashed } from '../services/privacy';
import { shownDateSql } from '../tools/photo';
import { toLocalDay } from '../utils/date';
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
    | 'contentContains'
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

// Canonical type token -> document category mappings. `photo` is not decided by category alone: see matchesTypes.
const TYPE_TO_CATEGORIES: Record<string, readonly string[]> = {
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
 * Whether a document is of any of `types`. A photo is always an image: one filed as photo or other, or one without
 * meaningful text. The image check keeps out the other files filed as "other" (markdown, PDF, text), and the videos,
 * audio and archives that also have no meaningful text.
 */
function matchesTypes(eb: ExpressionBuilder<SearchDatabase, 'd'>, types: readonly string[]) {
    const categories = [...new Set(types.filter((t) => t !== 'photo').flatMap((t) => TYPE_TO_CATEGORIES[t] ?? [t]))];
    const isPhoto = eb.and([
        eb('d.mime_type', 'like', 'image/%'),
        eb.or([eb('d.document_category', 'in', ['photo', 'other']), eb('d.has_meaningful_text', '=', false)]),
    ]);

    return eb.or([...(types.includes('photo') ? [isPhoto] : []), ...(categories.length ? [eb('d.document_category', 'in', categories)] : [])]);
}

/**
 * Type filter (photo, document, receipt, screenshot, video). Shared by search
 * and the type facet so a facet count equals the number of word matches the filter
 * returns on click. A click also reruns the meaning streams under the new filter,
 * so the result can hold meaning matches the count did not (see semantic-rank.ts).
 */
export function applyTypesFilter(query: SearchQueryBase, types: readonly string[]): SearchQueryBase {
    if (types.length === 0) return query;

    return query.where((eb) => matchesTypes(eb, types));
}

/**
 * The bounds of a document date range, which is compared with a calendar day. A relative range counts from the local
 * day. An absolute one is parsed as UTC, and Postgres cuts a bound to its day in the process's time zone, so east of
 * UTC a year would end on the next New Year's Day.
 */
function toDayRange(range: DateRange): DateRange {
    if (range.relative) return range;

    return { start: range.start && toLocalDay(range.start), end: range.end && toLocalDay(range.end) };
}

/**
 * Apply date range filter to query
 */
function applyDateRangeFilter<T extends SearchQueryBase>(
    query: T,
    dateRange: DateRange | undefined,
    column: 'd.created_at' | ReturnType<typeof shownDateSql>,
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
 * Apply negation filters to query. A dimension in `omit` skips its negated
 * filters together with its positive ones.
 */
function applyNegations<T extends SearchQueryBase>(
    query: T,
    negations: Partial<ParsedQuery> | undefined,
    userId: string,
    omit?: ReadonlySet<FilterDimension>,
): T {
    if (!negations) return query;

    // Negated types. `is not true` keeps a document without a category, for which the match is NULL.
    if (!omit?.has('types') && negations.types?.length) {
        const types = negations.types;
        query = query.where((eb) => eb(matchesTypes(eb, types), 'is not', true)) as T;
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
        query = query.where(outsideNamedFoldersSql('d.folder_id', userId, negations.folders)) as T;
    }

    return query;
}

/**
 * Apply all ParsedQuery filters (plus user scoping and privacy exclusion) to a
 * documents query. Dimensions listed in `omit` are skipped entirely — positive
 * and negated filters alike. User scoping, privacy and what the request scopes
 * the search to (`scopeFolderId`, `scopeMedia`, `scopeKind`) are never omittable.
 * `alsoMatchIds` lets documents that matched by meaning stand in for the full-text match.
 */
export function applySearchFilters(
    query: SearchQueryBase,
    parsed: ParsedQuery,
    userId: string,
    privateFolderIds: string[],
    omit?: ReadonlySet<FilterDimension>,
    alsoMatchIds?: readonly string[],
): SearchQueryBase {
    // Always filter by user
    query = query.where('d.user_id', '=', userId);
    query = excludePrivateDocuments(query, privateFolderIds, 'd.');
    query = excludeTrashed(query, 'd.');

    if (parsed.scopeFolderId) query = query.where(withinFolderSql('d.folder_id', userId, parsed.scopeFolderId));

    if (parsed.scopeMedia) query = query.where(isMediaSql('d.mime_type'));

    if (parsed.scopeKind) query = query.where(isOfKind('d.mime_type', parsed.scopeKind));

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
            // Unified search vector includes filename, OCR text, LLM data, photo metadata, tags.
            // `alsoMatchIds` are the documents that matched by meaning (semantic-rank.ts): they join the
            // result set even though the words don't match. Every other filter below still applies to them.
            query = query.where((eb) =>
                alsoMatchIds?.length
                    ? eb.or([sql<SqlBool>`d.search_vector @@ ${tsQuery}`, eb('d.id', 'in', [...alsoMatchIds])])
                    : sql<SqlBool>`d.search_vector @@ ${tsQuery}`,
            );
        }
    }

    // Content-contains filter: substring match on OCR text (ANDs multiple values).
    // `ocr` is left-joined; NULL raw_text (no OCR) correctly fails to match.
    if (!omit?.has('contentContains') && parsed.contentContains?.length) {
        for (const value of parsed.contentContains) {
            query = query.where(sql<SqlBool>`ocr.raw_text ILIKE ${'%' + value + '%'}`);
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

    // Document date filter: the date a result is shown with, so a camera photo is found by its capture date
    if (!omit?.has('extractedDate')) {
        const days = parsed.extractedDateRange && toDayRange(parsed.extractedDateRange);

        query = applyDateRangeFilter(query, days, shownDateSql());
    }

    // Folder filter: any of the named folders, with everything beneath them
    if (!omit?.has('folders') && parsed.folders?.length) {
        query = query.where(inNamedFoldersSql('d.folder_id', userId, parsed.folders));
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
    return applyNegations(query, parsed.negations, userId, omit);
}

import type { SearchFacets, SearchQuery, SearchResponse, SearchResult, SuggestQuery } from '@reverie/shared';
import { sql, type SqlBool } from 'kysely';
import { db } from '../db/kysely';
import { getCategoryDescription } from '../ocr/category-classifier';
import { getStorageService } from '../services/storage.service';
import { formatDateOnly } from '../utils/date';
import { resolveThumbnailUrls } from '../utils/thumbnail-urls';
import { generateFacets } from './facets';
import { generateFilenameSnippet, generateSnippets, generateSummarySnippet } from './highlighter';
import { buildPrefixTsQuery, buildSearchQuery, type SearchQueryOptions } from './query-builder';
import { parseQuery, validateQuery } from './query-parser';

/**
 * Search Service
 *
 * Main orchestration layer for advanced search functionality.
 */

export interface SearchServiceOptions {
    userId: string;
}

/**
 * Main search function
 */
export async function search(query: SearchQuery, options: SearchServiceOptions): Promise<SearchResponse> {
    const startTime = performance.now();

    // Parse the query string
    const parsed = parseQuery(query.q);

    // Apply API-level filters (these override/supplement parsed query)
    if (query.category) {
        parsed.categories = parsed.categories ? [...parsed.categories, query.category] : [query.category];
    }

    if (query.folder_id) {
        parsed.folderIds = parsed.folderIds ? [...parsed.folderIds, query.folder_id] : [query.folder_id];
    }

    if (query.date_from) {
        parsed.extractedDateRange = {
            ...parsed.extractedDateRange,
            start: new Date(query.date_from),
        };
    }

    if (query.date_to) {
        parsed.extractedDateRange = {
            ...parsed.extractedDateRange,
            end: new Date(query.date_to),
        };
    }

    // Validate the parsed query
    const errors = validateQuery(parsed);

    if (errors.length > 0) {
        throw new Error(`Invalid query: ${errors.join(', ')}`);
    }

    // Build query options
    const queryOptions: SearchQueryOptions = {
        limit: query.limit,
        offset: query.offset,
        sortBy: query.sort_by,
        sortOrder: query.sort_order,
    };

    // Build base query with all joins
    const baseQuery = db
        .selectFrom('documents as d')
        .leftJoin('folders as f', 'f.id', 'd.folder_id')
        .leftJoin('ocr_results as ocr', 'ocr.document_id', 'd.id')
        .leftJoin('llm_results as llm', 'llm.document_id', 'd.id')
        .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id');

    // Build the search query (cast to any to handle left join nullable types)
    const searchQuery = buildSearchQuery(baseQuery as any, parsed, options.userId, queryOptions);

    // Select fields for results
    const resultsQuery = searchQuery.select([
        'd.id',
        'd.original_filename',
        'd.folder_id',
        'd.created_at',
        'd.extracted_date',
        'd.document_category',
        'd.mime_type',
        'd.size_bytes',
        'd.has_meaningful_text',
        'd.thumbnail_paths',
        'd.thumbnail_blurhash',
        'llm.summary as llm_summary',
        sql<string | null>`llm.metadata->>'title'`.as('llm_title'),
        sql<string | null>`llm.metadata->>'type'`.as('llm_processing_type'),
        'f.path as folder_path',
        'ocr.raw_text',
        'pm.city as photo_city',
        'pm.country as photo_country',
        'pm.taken_at as photo_taken_at',
    ]);

    // Add relevance score if text search
    let finalQuery = resultsQuery;

    if (parsed.fullText) {
        const tsQuery = buildPrefixTsQuery(parsed.fullText);

        if (tsQuery) {
            finalQuery = resultsQuery.select(sql<number>`COALESCE(ts_rank(d.search_vector, ${tsQuery}), 0)`.as('relevance'));
        }
    }

    // For counting, we'll run a simpler query
    const countBaseQuery = db
        .selectFrom('documents as d')
        .leftJoin('folders as f', 'f.id', 'd.folder_id')
        .leftJoin('ocr_results as ocr', 'ocr.document_id', 'd.id')
        .leftJoin('llm_results as llm', 'llm.document_id', 'd.id')
        .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id');

    // Apply the same filters to count query
    const filteredCountQuery = buildSearchQuery(countBaseQuery as any, parsed, options.userId, {
        ...queryOptions,
        limit: 1000000,
        offset: 0,
    });

    // Execute queries
    const [rows, countResult, facets] = await Promise.all([
        finalQuery.execute(),
        filteredCountQuery
            .clearSelect()
            .clearOrderBy()
            .clearLimit()
            .clearOffset()
            .select(sql<number>`count(DISTINCT d.id)::int`.as('count'))
            .executeTakeFirst(),
        query.include_facets ? generateFacets(parsed, options.userId) : Promise.resolve(undefined),
    ]);

    // Get document IDs for snippet generation
    const documentIds = rows.map((row) => row.id);

    // Generate snippets if text search
    let snippetMap = new Map<string, string>();

    if (parsed.fullText && documentIds.length > 0) {
        snippetMap = await generateSnippets(documentIds, parsed.fullText);
    }

    // Get tags for all documents
    const tagRows =
        documentIds.length > 0 ? await db.selectFrom('document_tags').select(['document_id', 'tag']).where('document_id', 'in', documentIds).execute() : [];

    const tagMap = new Map<string, string[]>();

    for (const row of tagRows) {
        if (!tagMap.has(row.document_id)) {
            tagMap.set(row.document_id, []);
        }

        tagMap.get(row.document_id)!.push(row.tag);
    }

    // Transform results (async for signed URL generation)
    const storageService = getStorageService();
    const results: SearchResult[] = await Promise.all(
        rows.map(async (row) => {
            // Generate snippet
            let snippet: string | null = null;

            if (parsed.fullText) {
                // Try OCR text snippet first
                snippet = snippetMap.get(row.id) ?? null;

                // Fall back to summary snippet
                if (!snippet && row.llm_summary) {
                    snippet = generateSummarySnippet(row.llm_summary, parsed.fullText);
                }

                // Fall back to filename snippet
                if (!snippet) {
                    snippet = generateFilenameSnippet(row.original_filename, parsed.fullText);
                }
            }

            // Get file extension from mime type
            const format = mimeToExtension(row.mime_type);

            const thumbnailPaths = row.thumbnail_paths as { sm: string; md: string; lg: string } | null;
            const thumbnailUrls = await resolveThumbnailUrls(storageService, thumbnailPaths);

            const displayName = computeDisplayName(row);

            return {
                document_id: row.id,
                display_name: displayName,
                filename: row.original_filename,
                folder_path: row.folder_path,
                folder_id: row.folder_id,
                uploaded_at: row.created_at.toISOString(),
                extracted_date: formatDateOnly(row.extracted_date),
                category: row.document_category as SearchResult['category'],
                mime_type: row.mime_type,
                format,
                snippet,
                has_text: row.has_meaningful_text,
                thumbnail_urls: thumbnailUrls,
                blurhash: row.thumbnail_blurhash,
                size_bytes: Number(row.size_bytes),
                tags: tagMap.get(row.id) ?? [],
                relevance: (row as any).relevance ?? null,
            };
        }),
    );

    const endTime = performance.now();

    return {
        total: countResult?.count ?? 0,
        results,
        facets: facets as SearchFacets | undefined,
        query: parsed,
        timing_ms: Math.round(endTime - startTime),
    };
}

/**
 * Find documents for organize flow (Layer 2 retrieval).
 * Returns document IDs + compact summary only. No full document rows to LLM.
 */
export interface FindDocumentsForOrganizeResult {
    total: number;
    document_ids: string[];
    summary: {
        categories: Record<string, number>;
        date_range: { min: string | null; max: string | null };
    };
    /** When group_by is set, groups replace flat document_ids. */
    groups?: Array<{
        category: string;
        year?: string | null;
        location?: { country: string | null; city: string | null } | null;
        /** Deterministic query that reproduces this group's document set. Null when ambiguous (e.g. "no location" can't be expressed). */
        source_query: string | null;
        document_ids: string[];
        count: number;
        date_range: { min: string | null; max: string | null };
        /** Top folder paths where these documents currently live (hint for no-op avoidance). */
        folder_distribution: Array<{ path: string; count: number }>;
    }>;
}

export interface CategoryOverviewItem {
    id: string;
    label: string;
    count: number;
}

export async function getCategoryOverview(userId: string): Promise<{ categories: CategoryOverviewItem[] }> {
    const rows = await db
        .selectFrom('documents')
        .select(['document_category', sql<number>`count(*)::int`.as('count')])
        .where('user_id', '=', userId)
        .where('document_category', 'is not', null)
        .groupBy('document_category')
        .orderBy(sql`count(*)`, 'desc')
        .execute();

    const categories: CategoryOverviewItem[] = rows
        .filter((r) => r.document_category)
        .map((r) => ({
            id: r.document_category!,
            label: getCategoryDescription(r.document_category!),
            count: r.count,
        }));

    return { categories };
}

export type FindDocumentsGroupBy = 'category' | 'category_year' | 'category_location_year';

/**
 * Build a deterministic search query for a group.
 * Returns null when the query would be ambiguous — e.g. a photo group with
 * no country can't be distinguished from "all photos" via query syntax.
 */
export function buildGroupSourceQuery(
    category: string,
    year: string | null,
    location: { country: string | null; city: string | null } | null,
    groupBy: FindDocumentsGroupBy,
): string | null {
    if (groupBy === 'category_location_year' && category === 'photo' && !location?.country) return null;

    if ((groupBy === 'category_year' || groupBy === 'category_location_year') && !year) return null;

    const parts: string[] = [`category:${category}`];

    if (location?.country) parts.push(`location:${location.country.toLowerCase()}`);

    if (year) parts.push(`date:${year}`);

    return parts.join(' ');
}

export async function findDocumentsForOrganize(
    query: string,
    options: { userId: string; limit?: number; group_by?: FindDocumentsGroupBy },
): Promise<FindDocumentsForOrganizeResult> {
    const maxLimit = options.group_by ? 2000 : 200;
    const limit = Math.min(options.limit ?? maxLimit, maxLimit);
    const parsed = parseQuery(query);

    const errors = validateQuery(parsed);

    if (errors.length > 0) {
        throw new Error(`Invalid query: ${errors.join(', ')}`);
    }

    const queryOptions: SearchQueryOptions = {
        limit,
        offset: 0,
        sortBy: parsed.fullText ? 'relevance' : 'uploaded',
        sortOrder: 'desc',
    };

    const baseQuery = db
        .selectFrom('documents as d')
        .leftJoin('folders as f', 'f.id', 'd.folder_id')
        .leftJoin('ocr_results as ocr', 'ocr.document_id', 'd.id')
        .leftJoin('llm_results as llm', 'llm.document_id', 'd.id')
        .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id');

    const searchQuery = buildSearchQuery(baseQuery as any, parsed, options.userId, queryOptions);

    const rows = await searchQuery
        .select([
            'd.id',
            'd.document_category',
            'd.extracted_date',
            'd.folder_id',
            'f.path as folder_path',
            'pm.country as photo_country',
            'pm.city as photo_city',
        ])
        .execute();

    if (rows.length === 0) {
        return {
            total: 0,
            document_ids: [],
            summary: { categories: {}, date_range: { min: null, max: null } },
        };
    }

    const groupBy = options.group_by;

    if (groupBy === 'category' || groupBy === 'category_year' || groupBy === 'category_location_year') {
        const byKey = new Map<
            string,
            {
                ids: string[];
                dates: Date[];
                category: string;
                year: string | null;
                location: { country: string | null; city: string | null } | null;
                pathCounts: Map<string, number>;
            }
        >();

        for (const r of rows) {
            const cat = r.document_category ?? 'other';
            const year = r.extracted_date ? String(new Date(r.extracted_date).getFullYear()) : null;
            const location =
                groupBy === 'category_location_year' && cat === 'photo'
                    ? {
                          country: r.photo_country ?? null,
                          city: r.photo_city ?? null,
                      }
                    : null;

            const locationKey = location ? (location.country ?? 'unknown') : 'n/a';

            const key =
                groupBy === 'category_year'
                    ? `${cat}\0${year ?? 'unknown'}`
                    : groupBy === 'category_location_year'
                      ? `${cat}\0${year ?? 'unknown'}\0${locationKey}`
                      : cat;

            if (!byKey.has(key)) {
                byKey.set(key, { ids: [], dates: [], category: cat, year, location, pathCounts: new Map() });
            }

            const entry = byKey.get(key)!;

            entry.ids.push(r.id);

            if (r.extracted_date) entry.dates.push(r.extracted_date);

            const fp = r.folder_path ?? '(unfiled)';
            entry.pathCounts.set(fp, (entry.pathCounts.get(fp) ?? 0) + 1);
        }

        const groups: FindDocumentsForOrganizeResult['groups'] = [];

        for (const entry of byKey.values()) {
            const dates = entry.dates;
            const dateMin = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
            const dateMax = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

            const folder_distribution = [...entry.pathCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([path, count]) => ({ path, count }));

            groups.push({
                category: entry.category,
                year: groupBy === 'category' ? undefined : entry.year,
                location: groupBy === 'category_location_year' ? entry.location : undefined,
                source_query: buildGroupSourceQuery(
                    entry.category,
                    groupBy === 'category' ? null : entry.year,
                    groupBy === 'category_location_year' ? entry.location : null,
                    groupBy,
                ),
                document_ids: entry.ids,
                count: entry.ids.length,
                date_range: {
                    min: dateMin ? dateMin.toISOString().slice(0, 10) : null,
                    max: dateMax ? dateMax.toISOString().slice(0, 10) : null,
                },
                folder_distribution,
            });
        }

        const document_ids = rows.map((r) => r.id);
        const categoryCounts: Record<string, number> = {};
        let dateMin: Date | null = null;
        let dateMax: Date | null = null;

        for (const r of rows) {
            const cat = r.document_category ?? 'other';

            categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

            const d = r.extracted_date;

            if (d) {
                if (!dateMin || d < dateMin) dateMin = d;

                if (!dateMax || d > dateMax) dateMax = d;
            }
        }

        return {
            total: document_ids.length,
            document_ids,
            summary: {
                categories: categoryCounts,
                date_range: {
                    min: dateMin ? dateMin.toISOString().slice(0, 10) : null,
                    max: dateMax ? dateMax.toISOString().slice(0, 10) : null,
                },
            },
            groups,
        };
    }

    const document_ids = rows.map((r) => r.id);

    const categoryCounts: Record<string, number> = {};
    let dateMin: Date | null = null;
    let dateMax: Date | null = null;

    for (const r of rows) {
        const cat = r.document_category ?? 'other';

        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

        const d = r.extracted_date;

        if (d) {
            if (!dateMin || d < dateMin) dateMin = d;

            if (!dateMax || d > dateMax) dateMax = d;
        }
    }

    return {
        total: document_ids.length,
        document_ids,
        summary: {
            categories: categoryCounts,
            date_range: {
                min: dateMin ? dateMin.toISOString().slice(0, 10) : null,
                max: dateMax ? dateMax.toISOString().slice(0, 10) : null,
            },
        },
    };
}

/**
 * Get folder overview for organize flow (Layer 1 retrieval).
 * Returns aggregated folder stats—no document rows.
 */
export interface FolderOverviewItem {
    id: string;
    path: string;
    parent_id: string | null;
    type: string;
    document_count: number;
    category_distribution: Record<string, number>;
    date_range: { min: string | null; max: string | null };
}

export async function getFolderOverview(userId: string): Promise<{ folders: FolderOverviewItem[] }> {
    const rows = await db
        .selectFrom('folders as f')
        .leftJoin('documents as d', (join) => join.onRef('d.folder_id', '=', 'f.id').onRef('d.user_id', '=', 'f.user_id'))
        .select(['f.id', 'f.path', 'f.parent_id', 'f.type', 'f.sort_order', 'd.id as doc_id', 'd.document_category', 'd.extracted_date'])
        .where('f.user_id', '=', userId)
        .orderBy('f.path', 'asc')
        .execute();

    const byFolder = new Map<
        string,
        { path: string; parent_id: string | null; type: string; sort_order: number; categories: Record<string, number>; dates: Date[] }
    >();

    for (const r of rows) {
        const key = r.id;

        if (!byFolder.has(key)) {
            byFolder.set(key, {
                path: r.path,
                parent_id: r.parent_id,
                type: r.type,
                sort_order: r.sort_order,
                categories: {},
                dates: [],
            });
        }

        const entry = byFolder.get(key)!;

        if (r.doc_id) {
            const cat = r.document_category ?? 'other';

            entry.categories[cat] = (entry.categories[cat] ?? 0) + 1;

            if (r.extracted_date) entry.dates.push(r.extracted_date);
        }
    }

    const folders: FolderOverviewItem[] = [];

    for (const [id, entry] of byFolder.entries()) {
        const dates = entry.dates;
        const dateMin = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
        const dateMax = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

        folders.push({
            id,
            path: entry.path,
            parent_id: entry.parent_id,
            type: entry.type,
            document_count: Object.values(entry.categories).reduce((a, b) => a + b, 0),
            category_distribution: entry.categories,
            date_range: {
                min: dateMin ? dateMin.toISOString().slice(0, 10) : null,
                max: dateMax ? dateMax.toISOString().slice(0, 10) : null,
            },
        });
    }

    return { folders };
}

/**
 * Get facets only (without full search results)
 */
export async function getFacetsOnly(query: string, userId: string): Promise<SearchFacets> {
    const parsed = parseQuery(query);

    return generateFacets(parsed, userId);
}

/**
 * Autocomplete suggestions
 */
export async function suggest(query: SuggestQuery, userId: string): Promise<string[]> {
    const { type, q, limit } = query;

    switch (type) {
        case 'filename':
            return suggestFilenames(q, userId, limit);
        case 'folder':
            return suggestFolders(q, userId, limit);
        case 'tag':
            return suggestTags(q, userId, limit);
        case 'entity':
            return suggestEntities(q, userId, limit);
        case 'category':
            return suggestCategories(q, userId, limit);
        case 'location':
            return suggestLocations(q, userId, limit);
        default:
            return [];
    }
}

/**
 * Suggest filenames
 */
async function suggestFilenames(prefix: string, userId: string, limit: number): Promise<string[]> {
    const results = await db
        .selectFrom('documents')
        .select('original_filename')
        .distinct()
        .where('user_id', '=', userId)
        .where('original_filename', 'ilike', `${prefix}%`)
        .orderBy('original_filename', 'asc')
        .limit(limit)
        .execute();

    return results.map((r) => r.original_filename);
}

/**
 * Suggest folders
 */
async function suggestFolders(prefix: string, userId: string, limit: number): Promise<string[]> {
    // Folder paths start with "/" (e.g. "/Documents/Photos").
    // Use contains match so "Doc" matches "/Documents/Photos".
    const pattern = `%${prefix}%`;

    const results = await db
        .selectFrom('folders')
        .select('path')
        .distinct()
        .where('user_id', '=', userId)
        .where('path', 'ilike', pattern)
        .orderBy('path', 'asc')
        .limit(limit)
        .execute();

    return results.map((r) => r.path);
}

/**
 * Suggest tags
 */
async function suggestTags(prefix: string, userId: string, limit: number): Promise<string[]> {
    const results = await db
        .selectFrom('document_tags as dt')
        .innerJoin('documents as d', 'd.id', 'dt.document_id')
        .select('dt.tag')
        .distinct()
        .where('d.user_id', '=', userId)
        .where('dt.tag', 'ilike', `${prefix}%`)
        .orderBy('dt.tag', 'asc')
        .limit(limit)
        .execute();

    return results.map((r) => r.tag);
}

/**
 * Suggest entities (companies from OCR)
 */
async function suggestEntities(prefix: string, userId: string, limit: number): Promise<string[]> {
    // This is a complex query that extracts entities from JSONB
    const results = await db
        .selectFrom('ocr_results as ocr')
        .innerJoin('documents as d', 'd.id', 'ocr.document_id')
        .select(sql<string>`DISTINCT jsonb_array_elements_text(ocr.metadata->'companies')`.as('entity'))
        .where('d.user_id', '=', userId)
        .where(sql<SqlBool>`ocr.metadata->'companies' IS NOT NULL`)
        .where(sql<SqlBool>`jsonb_array_elements_text(ocr.metadata->'companies') ILIKE ${prefix + '%'}`)
        .limit(limit)
        .execute();

    return results.map((r) => r.entity);
}

/**
 * Suggest categories
 */
async function suggestCategories(prefix: string, userId: string, limit: number): Promise<string[]> {
    const results = await db
        .selectFrom('documents')
        .select('document_category')
        .distinct()
        .where('user_id', '=', userId)
        .where('document_category', 'is not', null)
        .where('document_category', 'ilike', `${prefix}%`)
        .limit(limit)
        .execute();

    return results.filter((r) => r.document_category).map((r) => r.document_category!);
}

/**
 * Suggest locations (cities and countries from photo metadata)
 */
async function suggestLocations(prefix: string, userId: string, limit: number): Promise<string[]> {
    const pattern = `%${prefix}%`;

    const [cities, countries] = await Promise.all([
        db
            .selectFrom('photo_metadata as pm')
            .innerJoin('documents as d', 'd.id', 'pm.document_id')
            .select('pm.city')
            .distinct()
            .where('d.user_id', '=', userId)
            .where('pm.city', 'is not', null)
            .where('pm.city', 'ilike', pattern)
            .orderBy('pm.city', 'asc')
            .limit(limit)
            .execute(),
        db
            .selectFrom('photo_metadata as pm')
            .innerJoin('documents as d', 'd.id', 'pm.document_id')
            .select('pm.country')
            .distinct()
            .where('d.user_id', '=', userId)
            .where('pm.country', 'is not', null)
            .where('pm.country', 'ilike', pattern)
            .orderBy('pm.country', 'asc')
            .limit(limit)
            .execute(),
    ]);

    const results = new Set<string>();

    for (const row of cities) {
        if (row.city) results.add(row.city);
    }

    for (const row of countries) {
        if (row.country) results.add(row.country);
    }

    return Array.from(results).slice(0, limit);
}

/**
 * Compute a human-readable display name for a search result.
 *
 * Priority cascade:
 * 1. LLM-generated title (text_summary processing)
 * 2. EXIF location + date (photo_metadata)
 * 3. Vision description truncated to first sentence
 * 4. Category-based fallback with date
 * 5. Original filename
 */
function computeDisplayName(row: {
    original_filename: string;
    document_category: string | null;
    extracted_date: Date | null;
    llm_title: string | null;
    llm_summary: string | null;
    llm_processing_type: string | null;
    photo_city: string | null;
    photo_country: string | null;
    photo_taken_at: Date | null;
}): string {
    // 1. LLM title for text-processed documents
    if (row.llm_title && row.llm_processing_type === 'text_summary') {
        return row.llm_title;
    }

    // 2. EXIF location + date for photos
    const isPhoto = row.document_category === 'photo' || row.document_category === 'screenshot' || row.document_category === 'graphic';

    if (isPhoto && (row.photo_city || row.photo_country)) {
        const location = row.photo_city ?? row.photo_country;
        const date = row.photo_taken_at ?? row.extracted_date;

        if (date) {
            return `Photo in ${location}, ${formatShortDate(date)}`;
        }

        return `Photo in ${location}`;
    }

    if (isPhoto && (row.photo_taken_at || row.extracted_date)) {
        const date = row.photo_taken_at ?? row.extracted_date!;

        return `Photo, ${formatShortDate(date)}`;
    }

    // 3. Vision description (first sentence)
    if (row.llm_summary && row.llm_processing_type === 'vision_describe') {
        const firstSentence = row.llm_summary.split(/[.!?]\s/)[0];

        if (firstSentence && firstSentence.length <= 60) {
            return firstSentence;
        }

        if (firstSentence) {
            return firstSentence.slice(0, 57) + '...';
        }
    }

    // 4. Category-based fallback
    const categoryLabels: Record<string, string> = {
        screenshot: 'Screenshot',
        receipt: 'Receipt',
        invoice: 'Invoice',
    };

    const categoryLabel = row.document_category ? categoryLabels[row.document_category] : undefined;

    if (categoryLabel) {
        const date = row.extracted_date ?? row.photo_taken_at;

        if (date) {
            return `${categoryLabel}, ${formatShortDate(date)}`;
        }

        return categoryLabel;
    }

    // 5. Original filename
    return row.original_filename;
}

function formatShortDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Convert MIME type to file extension
 */
function mimeToExtension(mimeType: string): string {
    const mapping: Record<string, string> = {
        'application/pdf': 'pdf',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'image/tiff': 'tiff',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg',
        'text/plain': 'txt',
    };

    return mapping[mimeType] || mimeType.split('/').pop() || 'unknown';
}

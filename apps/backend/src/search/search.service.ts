import type { SearchFacets, SearchQuery, SearchResponse, SearchResult, SuggestQuery } from '@reverie/shared';
import { sql, type SqlBool } from 'kysely';
import { db } from '../db/kysely';
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
        finalQuery = resultsQuery.select(sql<number>`COALESCE(ts_rank(d.search_vector, ${tsQuery}), 0)`.as('relevance'));
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

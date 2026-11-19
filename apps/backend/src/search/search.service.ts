import type {
    CollectionSearchResult,
    DocumentSearchResult,
    ParsedQuery,
    SearchFacets,
    SearchHit,
    SearchQuery,
    SearchResponse,
    SuggestQuery,
} from '@reverie/shared';
import { sql, type SqlBool } from 'kysely';
import { db } from '../db/kysely';
import { excludePrivateDocuments, excludePrivateFolders, excludeTrashed, getPrivateFolderIds } from '../services/privacy';
import { getStorageService } from '../services/storage.service';
import { formatDateOnly } from '../utils/date';
import { resolveThumbnailUrls } from '../utils/thumbnail-urls';
import { generateFacets } from './facets';
import { buildPrefixTsQuery, documentJoins } from './filter-application';
import { generateFilenameSnippet, generateSnippets, generateSummarySnippet } from './highlighter';
import { buildSearchQuery, type SearchQueryOptions } from './query-builder';
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

    // Parse the query string — all filtering is expressed inside the q DSL
    const parsed = parseQuery(query.q);

    // Validate the parsed query
    const errors = validateQuery(parsed);

    if (errors.length > 0) {
        throw new Error(`Invalid query: ${errors.join(', ')}`);
    }

    const queryOptions: SearchQueryOptions = {
        limit: query.limit,
        offset: query.offset,
        sortBy: query.sort_by,
        sortOrder: query.sort_order,
    };

    // Private documents/folders are always excluded from search (#19).
    const privateFolderIds = await getPrivateFolderIds(options.userId);

    // Kick off facets in parallel with the main result query.
    const facetsPromise = query.include_facets ? generateFacets(parsed, options.userId, privateFolderIds) : Promise.resolve(undefined);

    // Collections/folders only join the results for plain text relevance searches (see shouldSearchFolders).
    const { results, total } = shouldSearchFolders(parsed, query)
        ? await searchInterleaved(parsed, options.userId, queryOptions, privateFolderIds)
        : await searchDocumentsPaged(parsed, options.userId, queryOptions, privateFolderIds);

    const facets = await facetsPromise;
    const endTime = performance.now();

    return {
        total,
        results,
        facets: facets as SearchFacets | undefined,
        query: parsed,
        timing_ms: Math.round(endTime - startTime),
    };
}

/**
 * Whether matched collections/folders should be interleaved into the results.
 *
 * Only for plain text relevance searches: folders have no size/mime/date/category
 * to satisfy structured document filters, and folder-scoped queries search *within*
 * a folder rather than for the folder itself.
 */
function shouldSearchFolders(parsed: ParsedQuery, query: SearchQuery): boolean {
    if (!parsed.fullText) return false;

    if (query.sort_by !== 'relevance') return false;

    if (parsed.searchScope === 'content' || parsed.searchScope === 'summary') return false;

    if (parsed.folders?.length || parsed.folderIds?.length) return false;

    const hasDocumentFilters = Boolean(
        parsed.types?.length ||
            parsed.formats?.length ||
            parsed.categories?.length ||
            parsed.tags?.length ||
            parsed.entities?.length ||
            parsed.locations?.length ||
            parsed.hasText !== undefined ||
            parsed.hasSummary !== undefined ||
            parsed.hasThumbnail !== undefined ||
            parsed.sizeMin !== undefined ||
            parsed.sizeMax !== undefined ||
            parsed.uploadedRange ||
            parsed.extractedDateRange ||
            parsed.negations,
    );

    return !hasDocumentFilters;
}

/** Documents-only path: existing behavior (browse, filters, non-relevance sorts). */
async function searchDocumentsPaged(
    parsed: ParsedQuery,
    userId: string,
    options: SearchQueryOptions,
    privateFolderIds: string[],
): Promise<{ results: SearchHit[]; total: number }> {
    const idRows = await buildSearchQuery(documentJoins(), parsed, userId, options, privateFolderIds).select('d.id').execute();
    const ids = (idRows as Array<{ id: string }>).map((r) => r.id);

    const [detailMap, total] = await Promise.all([fetchDocumentDetails(userId, ids, parsed), countDocuments(parsed, userId, privateFolderIds)]);

    const results = ids.map((id) => detailMap.get(id)).filter((r): r is DocumentSearchResult => r !== undefined);

    return { results, total };
}

/**
 * Interleaved path: merge documents and matching folders into one relevance-ranked page.
 *
 * We fetch the top `offset + limit` lightweight (id, rank) rows from each stream — enough
 * to cover the requested window after merging — sort them together, slice the page, and
 * only then hydrate full details for the ids actually on the page.
 */
async function searchInterleaved(
    parsed: ParsedQuery,
    userId: string,
    options: SearchQueryOptions,
    privateFolderIds: string[],
): Promise<{ results: SearchHit[]; total: number }> {
    const tsQuery = buildPrefixTsQuery(parsed.fullText!);

    if (!tsQuery) return searchDocumentsPaged(parsed, userId, options, privateFolderIds);

    const { limit, offset, sortOrder } = options;
    const window = offset + limit;

    const docOrderRows = (await buildSearchQuery(
        documentJoins(),
        parsed,
        userId,
        { limit: window, offset: 0, sortBy: 'relevance', sortOrder },
        privateFolderIds,
    )
        .select(['d.id', 'd.created_at', sql<number>`COALESCE(ts_rank(d.search_vector, ${tsQuery}), 0)`.as('relevance')])
        .execute()) as Array<{ id: string; created_at: Date; relevance: number }>;

    // Matched folders, excluding any that are private (mirrors document privacy filtering).
    const folderRows = await excludeTrashed(
        db
            .selectFrom('folders as f')
            .where('f.user_id', '=', userId)
            .where(sql<SqlBool>`f.search_vector @@ ${tsQuery}`)
            .$if(privateFolderIds.length > 0, (qb) => qb.where('f.id', 'not in', privateFolderIds)),
        'f.',
    )
        .select([
            'f.id',
            'f.name',
            'f.path',
            'f.description',
            'f.emoji',
            'f.type',
            'f.created_at',
            sql<number>`COALESCE(ts_rank(f.search_vector, ${tsQuery}), 0)`.as('relevance'),
            (eb) =>
                excludeTrashed(
                    eb
                        .selectFrom('documents as dd')
                        .select(sql<number>`count(*)::int`.as('count'))
                        .whereRef('dd.folder_id', '=', 'f.id'),
                    'dd.',
                ).as('document_count'),
        ])
        .orderBy('relevance', 'desc')
        .limit(window)
        .execute();

    const [docTotal, folderTotalRow] = await Promise.all([
        countDocuments(parsed, userId, privateFolderIds),
        excludeTrashed(
            db
                .selectFrom('folders as f')
                .where('f.user_id', '=', userId)
                .where(sql<SqlBool>`f.search_vector @@ ${tsQuery}`)
                .$if(privateFolderIds.length > 0, (qb) => qb.where('f.id', 'not in', privateFolderIds)),
            'f.',
        )
            .select(sql<number>`count(*)::int`.as('count'))
            .executeTakeFirst(),
    ]);
    const total = docTotal + (folderTotalRow?.count ?? 0);

    // Merge both streams by relevance (desc), newest first on ties, then take the page.
    type OrderEntry = { type: 'document' | 'collection'; id: string; relevance: number; ts: number };
    const entries: OrderEntry[] = [
        ...docOrderRows.map((r) => ({ type: 'document' as const, id: r.id, relevance: Number(r.relevance ?? 0), ts: r.created_at.getTime() })),
        ...folderRows.map((r) => ({ type: 'collection' as const, id: r.id, relevance: Number(r.relevance ?? 0), ts: r.created_at.getTime() })),
    ];
    entries.sort((a, b) => b.relevance - a.relevance || b.ts - a.ts);
    const pageEntries = entries.slice(offset, offset + limit);

    const pageDocIds = pageEntries.filter((e) => e.type === 'document').map((e) => e.id);
    const detailMap = await fetchDocumentDetails(userId, pageDocIds, parsed);

    const folderMap = new Map<string, CollectionSearchResult>(
        folderRows.map((r) => [
            r.id,
            {
                result_type: 'collection' as const,
                id: r.id,
                name: r.name,
                path: r.path,
                description: r.description,
                emoji: r.emoji,
                folder_type: r.type,
                document_count: Number(r.document_count ?? 0),
                snippet: r.description ? generateSummarySnippet(r.description, parsed.fullText!) : null,
                relevance: Number(r.relevance ?? 0),
            },
        ]),
    );

    const results: SearchHit[] = [];

    for (const entry of pageEntries) {
        const hit = entry.type === 'document' ? detailMap.get(entry.id) : folderMap.get(entry.id);

        if (hit) results.push(hit);
    }

    return { results, total };
}

/** Count matching documents (same filters, no pagination). */
export async function countDocuments(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<number> {
    const countResult = await buildSearchQuery(
        documentJoins(),
        parsed,
        userId,
        { limit: 1000000, offset: 0, sortBy: 'uploaded', sortOrder: 'desc' },
        privateFolderIds,
    )
        .clearSelect()
        .clearOrderBy()
        .clearLimit()
        .clearOffset()
        .select(sql<number>`count(DISTINCT d.id)::int`.as('count'))
        .executeTakeFirst();

    return countResult?.count ?? 0;
}

interface DocumentRow {
    id: string;
    original_filename: string;
    folder_id: string | null;
    created_at: Date;
    extracted_date: Date | null;
    document_category: string | null;
    mime_type: string;
    size_bytes: number | string;
    duration_seconds: number | null;
    has_meaningful_text: boolean;
    thumbnail_paths: unknown;
    thumbnail_blurhash: string | null;
    llm_summary: string | null;
    llm_title: string | null;
    llm_processing_type: string | null;
    folder_path: string | null;
    raw_text: string | null;
    photo_city: string | null;
    photo_country: string | null;
    photo_taken_at: Date | null;
    relevance?: number | null;
}

/** Hydrate full document results for a set of ids, keyed by id. */
async function fetchDocumentDetails(userId: string, ids: string[], parsed: ParsedQuery): Promise<Map<string, DocumentSearchResult>> {
    if (ids.length === 0) return new Map();

    const base = excludeTrashed(documentJoins().where('d.user_id', '=', userId).where('d.id', 'in', ids), 'd.').select([
        'd.id',
        'd.original_filename',
        'd.folder_id',
        'd.created_at',
        'd.extracted_date',
        'd.document_category',
        'd.mime_type',
        'd.size_bytes',
        'd.duration_seconds',
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

    const tsQuery = parsed.fullText ? buildPrefixTsQuery(parsed.fullText) : null;
    const query = tsQuery ? base.select(sql<number>`COALESCE(ts_rank(d.search_vector, ${tsQuery}), 0)`.as('relevance')) : base;

    const rows = (await query.execute()) as unknown as DocumentRow[];
    const enriched = await enrichDocumentRows(rows, parsed);

    return new Map(enriched.map((r) => [r.document_id, r]));
}

/** Transform raw document rows into DocumentSearchResults (snippets, tags, thumbnails, display name). */
async function enrichDocumentRows(rows: DocumentRow[], parsed: ParsedQuery): Promise<DocumentSearchResult[]> {
    const documentIds = rows.map((row) => row.id);

    let snippetMap = new Map<string, string>();

    if (parsed.fullText && documentIds.length > 0) {
        snippetMap = await generateSnippets(documentIds, parsed.fullText);
    }

    const tagRows =
        documentIds.length > 0 ? await db.selectFrom('document_tags').select(['document_id', 'tag']).where('document_id', 'in', documentIds).execute() : [];

    const tagMap = new Map<string, string[]>();

    for (const row of tagRows) {
        const tags = tagMap.get(row.document_id) ?? [];

        tags.push(row.tag);
        tagMap.set(row.document_id, tags);
    }

    const storageService = getStorageService();

    return Promise.all(
        rows.map(async (row) => {
            let snippet: string | null = null;

            if (parsed.fullText) {
                snippet = snippetMap.get(row.id) ?? null;

                if (!snippet && row.llm_summary) {
                    snippet = generateSummarySnippet(row.llm_summary, parsed.fullText);
                }

                if (!snippet) {
                    snippet = generateFilenameSnippet(row.original_filename, parsed.fullText);
                }
            }

            const format = mimeToExtension(row.mime_type);
            const thumbnailPaths = row.thumbnail_paths as { sm: string; md: string; lg: string } | null;
            const thumbnailUrls = await resolveThumbnailUrls(storageService, thumbnailPaths);
            const displayName = computeDisplayName(row);

            return {
                result_type: 'document' as const,
                document_id: row.id,
                display_name: displayName,
                filename: row.original_filename,
                folder_path: row.folder_path,
                folder_id: row.folder_id,
                uploaded_at: row.created_at.toISOString(),
                extracted_date: formatDateOnly(row.extracted_date),
                category: row.document_category as DocumentSearchResult['category'],
                mime_type: row.mime_type,
                format,
                snippet,
                has_text: row.has_meaningful_text,
                thumbnail_urls: thumbnailUrls,
                blurhash: row.thumbnail_blurhash,
                size_bytes: Number(row.size_bytes),
                duration_seconds: row.duration_seconds,
                tags: tagMap.get(row.id) ?? [],
                relevance: row.relevance ?? null,
            };
        }),
    );
}

/**
 * Get facets only (without full search results)
 */
export async function getFacetsOnly(query: string, userId: string): Promise<SearchFacets> {
    const parsed = parseQuery(query);
    const privateFolderIds = await getPrivateFolderIds(userId);

    return generateFacets(parsed, userId, privateFolderIds);
}

/**
 * Autocomplete suggestions
 */
export async function suggest(query: SuggestQuery, userId: string): Promise<string[]> {
    const { type, q, limit } = query;
    const privateFolderIds = await getPrivateFolderIds(userId);

    switch (type) {
        case 'filename':
            return suggestFilenames(q, userId, limit, privateFolderIds);
        case 'folder':
            return suggestFolders(q, userId, limit, privateFolderIds);
        case 'tag':
            return suggestTags(q, userId, limit, privateFolderIds);
        case 'entity':
            return suggestEntities(q, userId, limit, privateFolderIds);
        case 'category':
            return suggestCategories(q, userId, limit, privateFolderIds);
        case 'location':
            return suggestLocations(q, userId, limit, privateFolderIds);
        default:
            return [];
    }
}

/**
 * Suggest filenames
 */
async function suggestFilenames(prefix: string, userId: string, limit: number, privateFolderIds: string[]): Promise<string[]> {
    const query = db
        .selectFrom('documents')
        .select('original_filename')
        .distinct()
        .where('user_id', '=', userId)
        .where('original_filename', 'ilike', `${prefix}%`)
        .orderBy('original_filename', 'asc')
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, ''), '').execute();

    return results.map((r) => r.original_filename);
}

/**
 * Suggest folders
 */
async function suggestFolders(prefix: string, userId: string, limit: number, privateFolderIds: string[]): Promise<string[]> {
    // Folder paths start with "/" (e.g. "/Documents/Photos").
    // Use contains match so "Doc" matches "/Documents/Photos".
    const pattern = `%${prefix}%`;

    const query = db
        .selectFrom('folders')
        .select('path')
        .distinct()
        .where('user_id', '=', userId)
        .where('path', 'ilike', pattern)
        .orderBy('path', 'asc')
        .limit(limit);

    const results = await excludeTrashed(excludePrivateFolders(query, privateFolderIds, 'id'), '').execute();

    return results.map((r) => r.path);
}

/**
 * Suggest tags
 */
async function suggestTags(prefix: string, userId: string, limit: number, privateFolderIds: string[]): Promise<string[]> {
    const query = db
        .selectFrom('document_tags as dt')
        .innerJoin('documents as d', 'd.id', 'dt.document_id')
        .select('dt.tag')
        .distinct()
        .where('d.user_id', '=', userId)
        .where('dt.tag', 'ilike', `${prefix}%`)
        .orderBy('dt.tag', 'asc')
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, 'd.'), 'd.').execute();

    return results.map((r) => r.tag);
}

/**
 * Suggest entities (companies from OCR)
 */
async function suggestEntities(prefix: string, userId: string, limit: number, privateFolderIds: string[]): Promise<string[]> {
    // This is a complex query that extracts entities from JSONB
    const query = db
        .selectFrom('ocr_results as ocr')
        .innerJoin('documents as d', 'd.id', 'ocr.document_id')
        .select(sql<string>`DISTINCT jsonb_array_elements_text(ocr.metadata->'companies')`.as('entity'))
        .where('d.user_id', '=', userId)
        .where(sql<SqlBool>`ocr.metadata->'companies' IS NOT NULL`)
        .where(sql<SqlBool>`jsonb_array_elements_text(ocr.metadata->'companies') ILIKE ${prefix + '%'}`)
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, 'd.'), 'd.').execute();

    return results.map((r) => r.entity);
}

/**
 * Suggest categories
 */
async function suggestCategories(prefix: string, userId: string, limit: number, privateFolderIds: string[]): Promise<string[]> {
    const query = db
        .selectFrom('documents')
        .select('document_category')
        .distinct()
        .where('user_id', '=', userId)
        .where('document_category', 'is not', null)
        .where('document_category', 'ilike', `${prefix}%`)
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, ''), '').execute();

    return results.filter((r) => r.document_category).map((r) => r.document_category!);
}

/**
 * Suggest locations (cities and countries from photo metadata)
 */
async function suggestLocations(prefix: string, userId: string, limit: number, privateFolderIds: string[]): Promise<string[]> {
    const pattern = `%${prefix}%`;

    const citiesQuery = db
        .selectFrom('photo_metadata as pm')
        .innerJoin('documents as d', 'd.id', 'pm.document_id')
        .select('pm.city')
        .distinct()
        .where('d.user_id', '=', userId)
        .where('pm.city', 'is not', null)
        .where('pm.city', 'ilike', pattern)
        .orderBy('pm.city', 'asc')
        .limit(limit);

    const countriesQuery = db
        .selectFrom('photo_metadata as pm')
        .innerJoin('documents as d', 'd.id', 'pm.document_id')
        .select('pm.country')
        .distinct()
        .where('d.user_id', '=', userId)
        .where('pm.country', 'is not', null)
        .where('pm.country', 'ilike', pattern)
        .orderBy('pm.country', 'asc')
        .limit(limit);

    const [cities, countries] = await Promise.all([
        excludeTrashed(excludePrivateDocuments(citiesQuery, privateFolderIds, 'd.'), 'd.').execute(),
        excludeTrashed(excludePrivateDocuments(countriesQuery, privateFolderIds, 'd.'), 'd.').execute(),
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

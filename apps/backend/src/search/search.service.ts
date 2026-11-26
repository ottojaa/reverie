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
import { withinFolderSql } from '../services/folders/scope';
import { excludePrivateDocuments, excludePrivateFolders, excludeTrashed, getPrivateFolderIds } from '../services/privacy';
import { fetchDocumentDetails } from './document-hydration';
import { generateFacets } from './facets';
import { loadPublicFolderCounts } from './folder-counts';
import { placeFolders } from './folder-placement';
import { buildPrefixTsQuery, documentJoins } from './filter-application';
import { generateSummarySnippet } from './highlighter';
import { findRankedDocuments, type HybridContext, type RankedEntry } from './hybrid-search';
import { buildSearchQuery, type SearchQueryOptions } from './query-builder';
import { parseQuery, validateQuery } from './query-parser';
import { getSemanticSearch, type SemanticMatches } from './semantic-rank';

/**
 * Search Service
 *
 * Main orchestration layer for advanced search functionality.
 * Which documents match, and in what order, is decided in hybrid-search.ts.
 */

export interface SearchServiceOptions {
    userId: string;
}

/**
 * Main search function
 */
export async function search(query: SearchQuery, options: SearchServiceOptions): Promise<SearchResponse> {
    const startTime = performance.now();

    const parsed = toScopedQuery(query.q, { folderId: query.folder_id, media: query.media });

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
    const ctx: HybridContext = { userId: options.userId, privateFolderIds };

    // Meaning matches come first: the ranking and the facets are both computed over them. Falls back to none when ML is unavailable.
    const semantic = await getSemanticSearch().load(parsed, ctx);
    const facetsPromise = query.include_facets ? generateFacets(parsed, options.userId, privateFolderIds, semantic.ids) : Promise.resolve(undefined);

    // Folders only join the results for plain text relevance searches (see shouldSearchFolders).
    const { results, total } = shouldSearchFolders(parsed, query)
        ? await searchInterleaved(parsed, ctx, queryOptions, semantic)
        : await searchDocumentsPaged(parsed, ctx, queryOptions, semantic);

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

/** What a request narrows a search to, on top of the filters in the query string. */
interface SearchScope {
    folderId?: string;
    /** Photos and videos only. */
    media?: boolean;
}

/** The query string parsed (all its filtering is in the q DSL), narrowed to the scope the request names. */
function toScopedQuery(q: string, { folderId, media }: SearchScope): ParsedQuery {
    return { ...parseQuery(q), ...(folderId && { scopeFolderId: folderId }), ...(media && { scopeMedia: true }) };
}

/**
 * Whether matched folders should be interleaved into the results.
 *
 * Only for plain text relevance searches: folders have no size/mime/date/category
 * to satisfy structured document filters, and folder-scoped queries search *within*
 * a folder rather than for the folder itself.
 */
function shouldSearchFolders(parsed: ParsedQuery, query: SearchQuery): boolean {
    if (!parsed.fullText) return false;

    if (query.sort_by !== 'relevance') return false;

    if (parsed.searchScope === 'content' || parsed.searchScope === 'summary') return false;

    if (parsed.folders?.length || parsed.scopeFolderId || parsed.scopeMedia) return false;

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

/** Documents-only path: browse, filters, non-relevance sorts. */
async function searchDocumentsPaged(
    parsed: ParsedQuery,
    ctx: HybridContext,
    options: SearchQueryOptions,
    semantic: SemanticMatches,
): Promise<{ results: SearchHit[]; total: number }> {
    const ranked = await findRankedDocuments(parsed, ctx, options, semantic);
    const detailMap = await fetchDocumentDetails(
        ctx.userId,
        ranked.entries.map((entry) => entry.id),
        parsed,
    );

    return { results: toDocumentHits(ranked.entries, detailMap), total: ranked.total };
}

/** The hydrated documents for `entries`, in order, each tagged with why it matched. */
function toDocumentHits(entries: RankedEntry[], detailMap: Map<string, DocumentSearchResult>): DocumentSearchResult[] {
    const hits: DocumentSearchResult[] = [];

    for (const entry of entries) {
        const hit = detailMap.get(entry.id);

        if (hit) hits.push(entry.match ? { ...hit, match: entry.match } : hit);
    }

    return hits;
}

interface FolderRow {
    id: string;
    name: string;
    path: string;
    description: string | null;
    emoji: string | null;
    parent_id: string | null;
    created_at: Date;
    relevance: number;
}

function matchingFolders(userId: string, tsQuery: ReturnType<typeof buildPrefixTsQuery>, privateFolderIds: string[]) {
    return excludeTrashed(
        db
            .selectFrom('folders as f')
            .where('f.user_id', '=', userId)
            .where(sql<SqlBool>`f.search_vector @@ ${tsQuery}`)
            .$if(privateFolderIds.length > 0, (qb) => qb.where('f.id', 'not in', privateFolderIds)),
        'f.',
    );
}

/** Matched folders (never private ones, mirroring document privacy filtering) and how many there are in all. */
async function fetchMatchingFolders(
    userId: string,
    tsQuery: NonNullable<ReturnType<typeof buildPrefixTsQuery>>,
    privateFolderIds: string[],
    window: number,
): Promise<{ rows: FolderRow[]; total: number }> {
    const [rows, totalRow] = await Promise.all([
        matchingFolders(userId, tsQuery, privateFolderIds)
            .select([
                'f.id',
                'f.name',
                'f.path',
                'f.description',
                'f.emoji',
                'f.parent_id',
                'f.created_at',
                sql<number>`COALESCE(ts_rank(f.search_vector, ${tsQuery}), 0)`.as('relevance'),
            ])
            .orderBy('relevance', 'desc')
            .limit(window)
            .execute(),
        matchingFolders(userId, tsQuery, privateFolderIds)
            .select(sql<number>`count(*)::int`.as('count'))
            .executeTakeFirst(),
    ]);

    return { rows: rows as FolderRow[], total: totalRow?.count ?? 0 };
}

function toCollectionHit(folder: FolderRow, parsed: ParsedQuery, documentCount: number): CollectionSearchResult {
    return {
        result_type: 'collection',
        id: folder.id,
        name: folder.name,
        path: folder.path,
        description: folder.description,
        emoji: folder.emoji,
        document_count: documentCount,
        snippet: folder.description ? generateSummarySnippet(folder.description, parsed.fullText!) : null,
        relevance: Number(folder.relevance ?? 0),
    };
}

/**
 * Interleaved path: merge documents and matching folders into one relevance-ranked page.
 *
 * Documents come ranked (words and meaning) from findRankedDocuments, to the end of the requested
 * window; the matching folders are merged into that order, the page is sliced, and only then do
 * we hydrate full details for the documents actually on the page.
 */
async function searchInterleaved(
    parsed: ParsedQuery,
    ctx: HybridContext,
    options: SearchQueryOptions,
    semantic: SemanticMatches,
): Promise<{ results: SearchHit[]; total: number }> {
    const tsQuery = buildPrefixTsQuery(parsed.fullText!);

    if (!tsQuery) return searchDocumentsPaged(parsed, ctx, options, semantic);

    const { limit, offset } = options;
    const window = offset + limit;
    const [ranked, folders] = await Promise.all([
        findRankedDocuments(parsed, ctx, { ...options, limit: window, offset: 0 }, semantic),
        fetchMatchingFolders(ctx.userId, tsQuery, ctx.privateFolderIds, window),
    ]);
    const page = placeFolders(ranked.entries, folders.rows).slice(offset, offset + limit);
    const pageDocs = page.flatMap((item) => (item.type === 'document' ? [item.entry] : []));
    const pageFolderIds = page.flatMap((item) => (item.type === 'collection' ? [item.folder.id] : []));
    const [detailMap, folderCounts] = await Promise.all([
        fetchDocumentDetails(
            ctx.userId,
            pageDocs.map((entry) => entry.id),
            parsed,
        ),
        loadPublicFolderCounts(ctx.userId, pageFolderIds),
    ]);
    const documentHits = new Map(toDocumentHits(pageDocs, detailMap).map((hit) => [hit.document_id, hit]));
    const results: SearchHit[] = [];

    for (const item of page) {
        const hit = item.type === 'document' ? documentHits.get(item.entry.id) : toCollectionHit(item.folder, parsed, folderCounts.get(item.folder.id) ?? 0);

        if (hit) results.push(hit);
    }

    return { results, total: ranked.total + folders.total };
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

/**
 * Get facets only (without full search results)
 */
export async function getFacetsOnly(query: string, userId: string, scope: SearchScope = {}): Promise<SearchFacets> {
    const parsed = toScopedQuery(query, scope);
    const privateFolderIds = await getPrivateFolderIds(userId);
    const semantic = await getSemanticSearch().load(parsed, { userId, privateFolderIds });

    return generateFacets(parsed, userId, privateFolderIds, semantic.ids);
}

/**
 * Autocomplete suggestions
 */
export async function suggest(query: SuggestQuery, userId: string): Promise<string[]> {
    const { type, q, limit, folder_id } = query;
    const privateFolderIds = await getPrivateFolderIds(userId);
    const scope: SuggestScope = { userId, privateFolderIds, folderId: folder_id };

    switch (type) {
        case 'filename':
            return suggestFilenames(q, limit, scope);
        case 'folder':
            return suggestFolders(q, limit, scope);
        case 'tag':
            return suggestTags(q, limit, scope);
        case 'entity':
            return suggestEntities(q, limit, scope);
        case 'category':
            return suggestCategories(q, limit, scope);
        case 'location':
            return suggestLocations(q, limit, scope);
        default:
            return [];
    }
}

/** Whose library suggestions come from, what is hidden from them, and the folder they are narrowed to, if any. */
interface SuggestScope {
    userId: string;
    privateFolderIds: string[];
    folderId: string | undefined;
}

/**
 * Suggest filenames
 */
async function suggestFilenames(prefix: string, limit: number, { userId, privateFolderIds, folderId }: SuggestScope): Promise<string[]> {
    const query = db
        .selectFrom('documents')
        .select('original_filename')
        .distinct()
        .where('user_id', '=', userId)
        .where('original_filename', 'ilike', `${prefix}%`)
        .where(withinFolderSql('folder_id', userId, folderId))
        .orderBy('original_filename', 'asc')
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, ''), '').execute();

    return results.map((r) => r.original_filename);
}

/**
 * Suggest folders
 */
async function suggestFolders(prefix: string, limit: number, { userId, privateFolderIds, folderId }: SuggestScope): Promise<string[]> {
    // Folder paths start with "/" (e.g. "/Documents/Photos").
    // Use contains match so "Doc" matches "/Documents/Photos".
    const pattern = `%${prefix}%`;

    const query = db
        .selectFrom('folders')
        .select('path')
        .distinct()
        .where('user_id', '=', userId)
        .where('path', 'ilike', pattern)
        .where(withinFolderSql('id', userId, folderId))
        .orderBy('path', 'asc')
        .limit(limit);

    const results = await excludeTrashed(excludePrivateFolders(query, privateFolderIds, 'id'), '').execute();

    return results.map((r) => r.path);
}

/**
 * Suggest tags
 */
async function suggestTags(prefix: string, limit: number, { userId, privateFolderIds, folderId }: SuggestScope): Promise<string[]> {
    const query = db
        .selectFrom('document_tags as dt')
        .innerJoin('documents as d', 'd.id', 'dt.document_id')
        .select('dt.tag')
        .distinct()
        .where('d.user_id', '=', userId)
        .where('dt.tag', 'ilike', `${prefix}%`)
        .where(withinFolderSql('d.folder_id', userId, folderId))
        .orderBy('dt.tag', 'asc')
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, 'd.'), 'd.').execute();

    return results.map((r) => r.tag);
}

/**
 * Suggest entities (companies from OCR)
 */
async function suggestEntities(prefix: string, limit: number, { userId, privateFolderIds, folderId }: SuggestScope): Promise<string[]> {
    // This is a complex query that extracts entities from JSONB
    const query = db
        .selectFrom('ocr_results as ocr')
        .innerJoin('documents as d', 'd.id', 'ocr.document_id')
        .select(sql<string>`DISTINCT jsonb_array_elements_text(ocr.metadata->'companies')`.as('entity'))
        .where('d.user_id', '=', userId)
        .where(sql<SqlBool>`ocr.metadata->'companies' IS NOT NULL`)
        .where(sql<SqlBool>`jsonb_array_elements_text(ocr.metadata->'companies') ILIKE ${prefix + '%'}`)
        .where(withinFolderSql('d.folder_id', userId, folderId))
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, 'd.'), 'd.').execute();

    return results.map((r) => r.entity);
}

/**
 * Suggest categories
 */
async function suggestCategories(prefix: string, limit: number, { userId, privateFolderIds, folderId }: SuggestScope): Promise<string[]> {
    const query = db
        .selectFrom('documents')
        .select('document_category')
        .distinct()
        .where('user_id', '=', userId)
        .where('document_category', 'is not', null)
        .where('document_category', 'ilike', `${prefix}%`)
        .where(withinFolderSql('folder_id', userId, folderId))
        .limit(limit);

    const results = await excludeTrashed(excludePrivateDocuments(query, privateFolderIds, ''), '').execute();

    return results.filter((r) => r.document_category).map((r) => r.document_category!);
}

/**
 * Suggest locations (cities and countries from photo metadata)
 */
async function suggestLocations(prefix: string, limit: number, { userId, privateFolderIds, folderId }: SuggestScope): Promise<string[]> {
    const pattern = `%${prefix}%`;

    const citiesQuery = db
        .selectFrom('photo_metadata as pm')
        .innerJoin('documents as d', 'd.id', 'pm.document_id')
        .select('pm.city')
        .distinct()
        .where('d.user_id', '=', userId)
        .where('pm.city', 'is not', null)
        .where('pm.city', 'ilike', pattern)
        .where(withinFolderSql('d.folder_id', userId, folderId))
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
        .where(withinFolderSql('d.folder_id', userId, folderId))
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

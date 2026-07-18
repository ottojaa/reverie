import { sql, type SqlBool } from 'kysely';
import type { SearchFacets, FacetItem, ParsedQuery } from '@reverie/shared';
import { db } from '../db/kysely';
import { applySearchFilters, applyTypesFilter, documentJoins, type FilterDimension, type SearchQueryBase } from './filter-application';

/**
 * Faceted Search — query-narrowed filter counts.
 *
 * Every dimension's counts are computed with ALL active filters applied except
 * that dimension's own, so each count answers "how many results if I click
 * this?". See FacetItemSchema in @reverie/shared for the selected / zero-count
 * semantics.
 */

const CANONICAL_TYPES = ['photo', 'document', 'receipt', 'screenshot', 'video'] as const;

const countDistinctDocuments = sql<number>`count(DISTINCT d.id)::int`;

/**
 * Generate all facets for a search query
 */
export async function generateFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<SearchFacets> {
    // Run all facet queries in parallel
    const [types, formats, folders, uploadPeriod, tags, hasText, categories, entities, locations] = await Promise.all([
        getTypeFacets(parsed, userId, privateFolderIds),
        getFormatFacets(parsed, userId, privateFolderIds),
        getFolderFacets(parsed, userId, privateFolderIds),
        getUploadPeriodFacets(parsed, userId, privateFolderIds),
        getTagFacets(parsed, userId, privateFolderIds),
        getHasTextFacets(parsed, userId, privateFolderIds),
        getCategoryFacets(parsed, userId, privateFolderIds),
        getEntityFacets(parsed, userId, privateFolderIds),
        getLocationFacets(parsed, userId, privateFolderIds),
    ]);

    return {
        types,
        formats,
        folders,
        uploadPeriod,
        tags,
        hasText,
        categories,
        entities: entities.length > 0 ? entities : undefined,
        locations: locations.length > 0 ? locations : undefined,
    };
}

/** Facet base: all active filters applied except the omitted dimension(s). */
function narrowedBase(parsed: ParsedQuery, userId: string, privateFolderIds: string[], omit: FilterDimension[]): SearchQueryBase {
    return applySearchFilters(documentJoins(), parsed, userId, privateFolderIds, new Set(omit));
}

type NameMatcher = (a: string, b: string) => boolean;

const exactMatch: NameMatcher = (a, b) => a === b;
const caseInsensitiveMatch: NameMatcher = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * Append active positive filter values missing from the computed list as
 * { count: 0, selected: true } so a checked filter entry never disappears.
 * Zero-count unselected values stay omitted (never computed into the lists).
 */
function appendMissingSelected(items: FacetItem[], activeValues: string[] | undefined, matches: NameMatcher = exactMatch): FacetItem[] {
    if (!activeValues?.length) return items;

    const missing = activeValues.filter((value) => !items.some((item) => matches(item.name, value)));

    return [...items, ...missing.map((name) => ({ name, count: 0, selected: true }))];
}

/**
 * Type facets (photo, document, receipt, screenshot, video). Each count runs
 * the narrowed query through the same type predicate search uses, so the facet
 * count always equals the result count when clicked.
 */
async function getTypeFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const counts = await Promise.all(
        CANONICAL_TYPES.map((type) =>
            applyTypesFilter(narrowedBase(parsed, userId, privateFolderIds, ['types']), [type])
                .select(countDistinctDocuments.as('count'))
                .executeTakeFirst(),
        ),
    );

    const items = CANONICAL_TYPES.map((type, index) => ({
        name: type as string,
        count: counts[index]?.count ?? 0,
        selected: parsed.types?.includes(type) ?? false,
    })).filter((item) => item.count > 0 || item.selected);

    return appendMissingSelected(items, parsed.types).sort((a, b) => b.count - a.count);
}

/**
 * Format facets (pdf, jpg, png, etc.)
 */
async function getFormatFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const results = await narrowedBase(parsed, userId, privateFolderIds, ['formats'])
        .select(['d.mime_type', countDistinctDocuments.as('count')])
        .groupBy('d.mime_type')
        .orderBy(sql`count(DISTINCT d.id)`, 'desc')
        .limit(10)
        .execute();

    const items = results.map((row) => ({
        name: mimeToExtension(row.mime_type),
        count: row.count,
        selected: parsed.formats?.includes(mimeToExtension(row.mime_type)) ?? false,
    }));

    return appendMissingSelected(items, parsed.formats);
}

/**
 * Folder facets (top folders by document count)
 */
async function getFolderFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const results = await narrowedBase(parsed, userId, privateFolderIds, ['folders'])
        .select(['f.path', countDistinctDocuments.as('count')])
        .where('f.path', 'is not', null)
        .groupBy('f.path')
        .orderBy(sql`count(DISTINCT d.id)`, 'desc')
        .limit(10)
        .execute();

    const items = results
        .filter((row) => row.path)
        .map((row) => ({
            name: row.path,
            count: row.count,
            selected: parsed.folders?.includes(row.path) ?? false,
        }));

    return appendMissingSelected(items, parsed.folders);
}

/**
 * Upload period facets (this week, this month, etc.)
 */
async function getUploadPeriodFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

    const base = () => narrowedBase(parsed, userId, privateFolderIds, ['uploaded']).select(countDistinctDocuments.as('count'));

    const [thisWeek, thisMonth, thisYear, older] = await Promise.all([
        base().where('d.created_at', '>=', weekAgo).executeTakeFirst(),
        base().where('d.created_at', '>=', monthAgo).where('d.created_at', '<', weekAgo).executeTakeFirst(),
        base().where('d.created_at', '>=', yearAgo).where('d.created_at', '<', monthAgo).executeTakeFirst(),
        base().where('d.created_at', '<', yearAgo).executeTakeFirst(),
    ]);

    const buckets: FacetItem[] = [
        { name: 'This week', count: thisWeek?.count ?? 0, selected: parsed.uploadedRange?.relative === 'last-week' },
        { name: 'This month', count: thisMonth?.count ?? 0, selected: parsed.uploadedRange?.relative === 'last-month' },
        { name: 'This year', count: thisYear?.count ?? 0, selected: parsed.uploadedRange?.relative === 'last-year' },
        { name: 'Older', count: older?.count ?? 0, selected: false },
    ];

    return buckets.filter((bucket) => bucket.count > 0 || bucket.selected);
}

/**
 * Tag facets
 */
async function getTagFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const matchingDocumentIds = narrowedBase(parsed, userId, privateFolderIds, ['tags']).select('d.id');

    const results = await db
        .selectFrom('document_tags as dt')
        .select(['dt.tag', sql<number>`count(DISTINCT dt.document_id)::int`.as('count')])
        .where('dt.document_id', 'in', matchingDocumentIds)
        .groupBy('dt.tag')
        .orderBy(sql`count(DISTINCT dt.document_id)`, 'desc')
        .limit(20)
        .execute();

    const items = results.map((row) => ({
        name: row.tag,
        count: row.count,
        selected: parsed.tags?.includes(row.tag) ?? false,
    }));

    return appendMissingSelected(items, parsed.tags);
}

/**
 * Has text facets
 */
async function getHasTextFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const base = () => narrowedBase(parsed, userId, privateFolderIds, ['hasText']).select(countDistinctDocuments.as('count'));

    const [withText, withoutText] = await Promise.all([
        base().where('d.has_meaningful_text', '=', true).executeTakeFirst(),
        base().where('d.has_meaningful_text', '=', false).executeTakeFirst(),
    ]);

    const items: FacetItem[] = [
        { name: 'With text', count: withText?.count ?? 0, selected: parsed.hasText === true },
        { name: 'Without text', count: withoutText?.count ?? 0, selected: parsed.hasText === false },
    ];

    return items.filter((item) => item.count > 0 || item.selected);
}

/**
 * Category facets. Omits BOTH the categories and types dimensions: type
 * filters expand to category predicates, so leaving an active type filter
 * applied would zero out every sibling category.
 */
async function getCategoryFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const results = await narrowedBase(parsed, userId, privateFolderIds, ['types', 'categories'])
        .select(['d.document_category', countDistinctDocuments.as('count')])
        .where('d.document_category', 'is not', null)
        .groupBy('d.document_category')
        .orderBy(sql`count(DISTINCT d.id)`, 'desc')
        .limit(20)
        .execute();

    const items = results
        .filter((row) => row.document_category)
        .map((row) => ({
            name: row.document_category!,
            count: row.count,
            selected: parsed.categories?.includes(row.document_category!) ?? false,
        }));

    return appendMissingSelected(items, parsed.categories);
}

/**
 * Entity facets (organization names extracted by the LLM)
 */
async function getEntityFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const matchingDocumentIds = narrowedBase(parsed, userId, privateFolderIds, ['entities']).select('d.id');

    // Unnest llm_results.metadata->'entities' and count organization canonical names.
    const results = await db
        .selectFrom('llm_results as llm')
        .innerJoinLateral(sql`jsonb_array_elements(llm.metadata->'entities')`.as('ent'), (join) => join.onTrue())
        .select([sql<string>`ent.value->>'canonical_name'`.as('entity'), sql<number>`count(DISTINCT llm.document_id)::int`.as('count')])
        .where('llm.document_id', 'in', matchingDocumentIds)
        .where(sql<SqlBool>`jsonb_typeof(llm.metadata->'entities') = 'array'`)
        .where(sql<SqlBool>`ent.value->>'type' = 'organization'`)
        .where(sql<SqlBool>`ent.value->>'canonical_name' IS NOT NULL`)
        .groupBy(sql`ent.value->>'canonical_name'`)
        .orderBy(sql`count(DISTINCT llm.document_id)`, 'desc')
        .limit(15)
        .execute();

    const items = results.map((row) => ({
        name: row.entity,
        count: row.count,
        selected: parsed.entities?.includes(row.entity) ?? false,
    }));

    return appendMissingSelected(items, parsed.entities);
}

/**
 * Location facets (countries with photo metadata, ordered by count). The
 * location filter matches case-insensitively (ILIKE), so selected-marking
 * does too.
 */
async function getLocationFacets(parsed: ParsedQuery, userId: string, privateFolderIds: string[]): Promise<FacetItem[]> {
    const matchingDocumentIds = narrowedBase(parsed, userId, privateFolderIds, ['locations']).select('d.id');

    const results = await db
        .selectFrom('photo_metadata as pm')
        .select(['pm.country', sql<number>`count(DISTINCT pm.document_id)::int`.as('count')])
        .where('pm.document_id', 'in', matchingDocumentIds)
        .where('pm.country', 'is not', null)
        .groupBy('pm.country')
        .orderBy(sql`count(DISTINCT pm.document_id)`, 'desc')
        .limit(20)
        .execute();

    const items = results
        .filter((row) => row.country)
        .map((row) => ({
            name: row.country!,
            count: row.count,
            selected: parsed.locations?.some((loc) => caseInsensitiveMatch(loc, row.country!)) ?? false,
        }));

    return appendMissingSelected(items, parsed.locations, caseInsensitiveMatch);
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

import { sql, type SqlBool } from 'kysely';
import type { SearchFacets, FacetItem, ParsedQuery } from '@reverie/shared';
import { db } from '../db/kysely';

/**
 * Faceted Search - Generate filter counts
 *
 * Provides counts for each filter option based on current search results.
 */

/**
 * Generate all facets for a search query
 */
export async function generateFacets(parsed: ParsedQuery, userId: string): Promise<SearchFacets> {
    // Run all facet queries in parallel
    const [types, formats, folders, uploadPeriod, tags, hasText, categories, entities] = await Promise.all([
        getTypeFacets(parsed, userId),
        getFormatFacets(parsed, userId),
        getFolderFacets(parsed, userId),
        getUploadPeriodFacets(parsed, userId),
        getTagFacets(parsed, userId),
        getHasTextFacets(parsed, userId),
        getCategoryFacets(parsed, userId),
        getEntityFacets(parsed, userId),
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
    };
}

/**
 * Get base query for facet counting (applies current filters except the facet being counted)
 */
function getBaseQuery(userId: string) {
    return db
        .selectFrom('documents as d')
        .leftJoin('folders as f', 'f.id', 'd.folder_id')
        .leftJoin('ocr_results as ocr', 'ocr.document_id', 'd.id')
        .where('d.user_id', '=', userId);
}

/**
 * Type facets (photo, document, receipt, screenshot)
 */
async function getTypeFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    // Count photos (documents without meaningful text)
    const photoCount = await getBaseQuery(userId)
        .select(sql<number>`count(*)::int`.as('count'))
        .where('d.has_meaningful_text', '=', false)
        .executeTakeFirst();

    // Count documents with text
    const docCount = await getBaseQuery(userId)
        .select(sql<number>`count(*)::int`.as('count'))
        .where('d.has_meaningful_text', '=', true)
        .executeTakeFirst();

    // Count receipts specifically
    const receiptCount = await getBaseQuery(userId)
        .select(sql<number>`count(*)::int`.as('count'))
        .where('d.document_category', '=', 'transaction_receipt')
        .executeTakeFirst();

    const facets: FacetItem[] = [];

    if ((photoCount?.count ?? 0) > 0) {
        facets.push({
            name: 'photo',
            count: photoCount?.count ?? 0,
            selected: parsed.types?.includes('photo'),
        });
    }

    if ((docCount?.count ?? 0) > 0) {
        facets.push({
            name: 'document',
            count: docCount?.count ?? 0,
            selected: parsed.types?.includes('document'),
        });
    }

    if ((receiptCount?.count ?? 0) > 0) {
        facets.push({
            name: 'receipt',
            count: receiptCount?.count ?? 0,
            selected: parsed.types?.includes('receipt'),
        });
    }

    return facets.sort((a, b) => b.count - a.count);
}

/**
 * Format facets (pdf, jpg, png, etc.)
 */
async function getFormatFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    const results = await getBaseQuery(userId)
        .select(['d.mime_type', sql<number>`count(*)::int`.as('count')])
        .groupBy('d.mime_type')
        .orderBy(sql`count(*)`, 'desc')
        .limit(10)
        .execute();

    return results.map((row) => ({
        name: mimeToExtension(row.mime_type),
        count: row.count,
        selected: parsed.formats?.includes(mimeToExtension(row.mime_type)),
    }));
}

/**
 * Folder facets (top folders by document count)
 */
async function getFolderFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    const results = await getBaseQuery(userId)
        .select(['f.path', sql<number>`count(*)::int`.as('count')])
        .where('f.path', 'is not', null)
        .groupBy('f.path')
        .orderBy(sql`count(*)`, 'desc')
        .limit(10)
        .execute();

    return results
        .filter((row) => row.path)
        .map((row) => ({
            name: row.path!,
            count: row.count,
            selected: parsed.folders?.includes(row.path!),
        }));
}

/**
 * Upload period facets (this week, this month, etc.)
 */
async function getUploadPeriodFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

    const [thisWeek, thisMonth, thisYear, older] = await Promise.all([
        getBaseQuery(userId)
            .select(sql<number>`count(*)::int`.as('count'))
            .where('d.created_at', '>=', weekAgo)
            .executeTakeFirst(),
        getBaseQuery(userId)
            .select(sql<number>`count(*)::int`.as('count'))
            .where('d.created_at', '>=', monthAgo)
            .where('d.created_at', '<', weekAgo)
            .executeTakeFirst(),
        getBaseQuery(userId)
            .select(sql<number>`count(*)::int`.as('count'))
            .where('d.created_at', '>=', yearAgo)
            .where('d.created_at', '<', monthAgo)
            .executeTakeFirst(),
        getBaseQuery(userId)
            .select(sql<number>`count(*)::int`.as('count'))
            .where('d.created_at', '<', yearAgo)
            .executeTakeFirst(),
    ]);

    const facets: FacetItem[] = [];

    if ((thisWeek?.count ?? 0) > 0) {
        facets.push({
            name: 'This week',
            count: thisWeek?.count ?? 0,
            selected: parsed.uploadedRange?.relative === 'last-week',
        });
    }

    if ((thisMonth?.count ?? 0) > 0) {
        facets.push({
            name: 'This month',
            count: thisMonth?.count ?? 0,
            selected: parsed.uploadedRange?.relative === 'last-month',
        });
    }

    if ((thisYear?.count ?? 0) > 0) {
        facets.push({
            name: 'This year',
            count: thisYear?.count ?? 0,
            selected: parsed.uploadedRange?.relative === 'last-year',
        });
    }

    if ((older?.count ?? 0) > 0) {
        facets.push({
            name: 'Older',
            count: older?.count ?? 0,
        });
    }

    return facets;
}

/**
 * Tag facets
 */
async function getTagFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    const results = await db
        .selectFrom('document_tags as dt')
        .innerJoin('documents as d', 'd.id', 'dt.document_id')
        .select(['dt.tag', sql<number>`count(*)::int`.as('count')])
        .where('d.user_id', '=', userId)
        .groupBy('dt.tag')
        .orderBy(sql`count(*)`, 'desc')
        .limit(20)
        .execute();

    return results.map((row) => ({
        name: row.tag,
        count: row.count,
        selected: parsed.tags?.includes(row.tag),
    }));
}

/**
 * Has text facets
 */
async function getHasTextFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    const [withText, withoutText] = await Promise.all([
        getBaseQuery(userId)
            .select(sql<number>`count(*)::int`.as('count'))
            .where('d.has_meaningful_text', '=', true)
            .executeTakeFirst(),
        getBaseQuery(userId)
            .select(sql<number>`count(*)::int`.as('count'))
            .where('d.has_meaningful_text', '=', false)
            .executeTakeFirst(),
    ]);

    const facets: FacetItem[] = [];

    if ((withText?.count ?? 0) > 0) {
        facets.push({
            name: 'With text',
            count: withText?.count ?? 0,
            selected: parsed.hasText === true,
        });
    }

    if ((withoutText?.count ?? 0) > 0) {
        facets.push({
            name: 'Without text',
            count: withoutText?.count ?? 0,
            selected: parsed.hasText === false,
        });
    }

    return facets;
}

/**
 * Category facets
 */
async function getCategoryFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    const results = await getBaseQuery(userId)
        .select(['d.document_category', sql<number>`count(*)::int`.as('count')])
        .where('d.document_category', 'is not', null)
        .groupBy('d.document_category')
        .orderBy(sql`count(*)`, 'desc')
        .execute();

    return results
        .filter((row) => row.document_category)
        .map((row) => ({
            name: row.document_category!,
            count: row.count,
            selected: parsed.categories?.includes(row.document_category!),
        }));
}

/**
 * Entity facets (companies extracted from OCR)
 */
async function getEntityFacets(parsed: ParsedQuery, userId: string): Promise<FacetItem[]> {
    // Extract companies from OCR metadata JSONB
    const results = await db
        .selectFrom('ocr_results as ocr')
        .innerJoin('documents as d', 'd.id', 'ocr.document_id')
        .select([sql<string>`jsonb_array_elements_text(ocr.metadata->'companies')`.as('entity'), sql<number>`count(*)::int`.as('count')])
        .where('d.user_id', '=', userId)
        .where(sql<SqlBool>`ocr.metadata->'companies' IS NOT NULL`)
        .where(sql<SqlBool>`jsonb_array_length(ocr.metadata->'companies') > 0`)
        .groupBy(sql`jsonb_array_elements_text(ocr.metadata->'companies')`)
        .orderBy(sql`count(*)`, 'desc')
        .limit(15)
        .execute();

    return results.map((row) => ({
        name: row.entity,
        count: row.count,
        selected: parsed.entities?.includes(row.entity),
    }));
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

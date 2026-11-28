import type { ParsedQuery, SortBy } from '@reverie/shared';
import { sql, type SelectQueryBuilder } from 'kysely';
import { shownDateSql } from '../tools/photo';
import { applySearchFilters, buildPrefixTsQuery, type SearchDatabase, type SearchQueryBase } from './filter-application';

/**
 * Query Builder for Advanced Search
 *
 * Converts ParsedQuery into efficient Kysely SQL queries using PostgreSQL
 * full-text search. Filter application lives in filter-application.ts; this
 * module adds sorting and pagination on top.
 */

export interface SearchQueryOptions {
    limit: number;
    offset: number;
    sortBy: SortBy;
    sortOrder: 'asc' | 'desc';
}

/**
 * Apply the sort order for the requested sortBy to the query
 */
function applySorting(query: SearchQueryBase, parsed: ParsedQuery, options: SearchQueryOptions): SearchQueryBase {
    if (options.sortBy === 'relevance' && parsed.fullText) {
        const tsQuery = buildPrefixTsQuery(parsed.fullText);

        if (tsQuery) {
            // `d.id` last: equal ranks and timestamps (a bulk upload) must not swap between pages.
            return query
                .orderBy(sql`ts_rank(d.search_vector, ${tsQuery})`, options.sortOrder === 'desc' ? 'desc' : 'asc')
                .orderBy('d.created_at', 'desc')
                .orderBy('d.id');
        }

        return query.orderBy('d.created_at', 'desc').orderBy('d.id');
    }

    if (options.sortBy === 'uploaded') {
        return query.orderBy('d.created_at', options.sortOrder);
    }

    if (options.sortBy === 'date') {
        // Postgres puts nulls first in a descending order; documents with no shown date go last in both. Kysely 0.27
        // has no `nulls last` method, so it is part of the direction. `d.id` last: equal dates must not swap between pages.
        const dateOrder = options.sortOrder === 'desc' ? sql`desc nulls last` : sql`asc nulls last`;

        return query.orderBy(shownDateSql(), dateOrder).orderBy('d.created_at', options.sortOrder).orderBy('d.id');
    }

    if (options.sortBy === 'filename') {
        return query.orderBy('d.original_filename', options.sortOrder);
    }

    if (options.sortBy === 'size') {
        return query.orderBy('d.size_bytes', options.sortOrder);
    }

    // Default: newest first
    return query.orderBy('d.created_at', 'desc');
}

/**
 * Build the main search query from ParsedQuery
 */
export function buildSearchQuery(
    baseQuery: SearchQueryBase,
    parsed: ParsedQuery,
    userId: string,
    options: SearchQueryOptions,
    privateFolderIds: string[],
    alsoMatchIds?: readonly string[],
): SearchQueryBase {
    const filtered = applySearchFilters(baseQuery, parsed, userId, privateFolderIds, undefined, alsoMatchIds);
    const sorted = applySorting(filtered, parsed, options);

    return sorted.limit(options.limit).offset(options.offset);
}

/**
 * Build the count query (same filters, no pagination)
 */
export function buildCountQuery(
    baseQuery: SelectQueryBuilder<SearchDatabase, 'd' | 'f' | 'ocr' | 'llm' | 'pm', object>,
    parsed: ParsedQuery,
    userId: string,
    privateFolderIds: string[],
    alsoMatchIds?: readonly string[],
): SelectQueryBuilder<SearchDatabase, 'd' | 'f' | 'ocr' | 'llm' | 'pm', { count: number }> {
    // Reuse the search query builder but without sorting and pagination
    const query = buildSearchQuery(
        baseQuery,
        parsed,
        userId,
        {
            limit: 1000000, // Will be ignored
            offset: 0,
            sortBy: 'uploaded',
            sortOrder: 'desc',
        },
        privateFolderIds,
        alsoMatchIds,
    );

    // Replace select with count
    return query
        .clearSelect()
        .clearOrderBy()
        .clearLimit()
        .clearOffset()
        .select(sql<number>`count(*)::int`.as('count')) as SelectQueryBuilder<SearchDatabase, 'd' | 'f' | 'ocr' | 'llm' | 'pm', { count: number }>;
}

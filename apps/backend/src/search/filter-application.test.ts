import { describe, expect, it } from 'vitest';
import type { ParsedQuery } from '@reverie/shared';
import { applySearchFilters, documentJoins, type FilterDimension } from './filter-application';
import { buildSearchQuery } from './query-builder';

/**
 * DB-less assertions: queries are compiled to SQL, never executed. Verifies
 * that an omitted dimension's clause disappears while the others remain.
 */

const USER_ID = 'user-1';

function compile(parsed: ParsedQuery, omit?: FilterDimension[]) {
    return applySearchFilters(documentJoins(), parsed, USER_ID, [], omit ? new Set(omit) : undefined)
        .select('d.id')
        .compile();
}

const FULL_QUERY: ParsedQuery = {
    fullText: 'beach',
    types: ['photo'],
    formats: ['pdf'],
    categories: ['receipt'],
    uploadedRange: { start: new Date('2024-01-01') },
    extractedDateRange: { end: new Date('2024-12-31') },
    folders: ['/inbox'],
    hasSummary: true,
    sizeMin: 10 * 1024 * 1024,
    tags: ['tax'],
    entities: ['Nordea'],
    locations: ['Spain'],
};

describe('applySearchFilters', () => {
    it('always applies user scoping and privacy exclusion, even with omissions', () => {
        const { sql } = compile({}, ['types', 'fullText']);

        expect(sql).toContain('"d"."user_id" =');
        expect(sql).toContain('"d"."is_private" =');
    });

    it('applies every dimension of a full query', () => {
        const { sql } = compile(FULL_QUERY);

        expect(sql).toContain('search_vector @@');
        expect(sql).toContain('"d"."document_category" in');
        expect(sql).toContain('"d"."mime_type" in');
        expect(sql).toContain('"d"."created_at" >=');
        expect(sql).toContain('"d"."extracted_date" <=');
        expect(sql).toContain('"f"."path" =');
        expect(sql).toContain('"llm"."summary" is not null');
        expect(sql).toContain('"d"."size_bytes" >=');
        expect(sql).toContain('SELECT document_id FROM document_tags');
        expect(sql).toContain("llm.metadata->'entities'");
        expect(sql).toContain('pm.country ILIKE');
    });

    it('omitting types drops the category expansion but keeps other filters', () => {
        const { sql } = compile({ types: ['photo'], sizeMin: 1024 }, ['types']);

        expect(sql).not.toContain('document_category');
        expect(sql).toContain('"d"."size_bytes" >=');
    });

    it('omitting formats drops the mime filter but keeps types', () => {
        const { sql } = compile({ types: ['receipt'], formats: ['pdf'] }, ['formats']);

        expect(sql).not.toContain('mime_type');
        expect(sql).toContain('"d"."document_category" in');
    });

    it('omitting fullText drops the tsquery clause', () => {
        const { sql } = compile({ fullText: 'beach', sizeMax: 100 }, ['fullText']);

        expect(sql).not.toContain('search_vector');
        expect(sql).toContain('"d"."size_bytes" <=');
    });

    it('omitting uploaded drops created_at but keeps extracted_date', () => {
        const { sql } = compile({ uploadedRange: { relative: 'last-week' }, extractedDateRange: { start: new Date('2024-01-01') } }, ['uploaded']);

        expect(sql).not.toContain('created_at');
        expect(sql).toContain('"d"."extracted_date" >=');
    });

    it('omitting folders drops both folder paths and folder ids', () => {
        const { sql } = compile({ folders: ['/inbox'], folderIds: ['00000000-0000-0000-0000-000000000000'] }, ['folders']);

        expect(sql).not.toContain('"f"."path"');
        expect(sql).not.toContain('folder_id" in');
    });

    it('omitting tags drops positive and negated tag filters together', () => {
        const { sql } = compile({ tags: ['tax'], negations: { tags: ['archived'] } }, ['tags']);

        expect(sql).not.toContain('document_tags');
    });

    it('applies negated -has:text as has_meaningful_text = false', () => {
        const { sql, parameters } = compile({ negations: { hasText: false } });

        expect(sql).toContain('"d"."has_meaningful_text" =');
        expect(parameters).toContain(false);
    });

    it('omitting hasText drops the negated -has:text clause too', () => {
        const { sql } = compile({ negations: { hasText: false } }, ['hasText']);

        expect(sql).not.toContain('has_meaningful_text');
    });
});

describe('buildSearchQuery', () => {
    it('is applySearchFilters plus sorting and pagination', () => {
        const filterSql = compile(FULL_QUERY).sql;
        const searchSql = buildSearchQuery(documentJoins(), FULL_QUERY, USER_ID, { limit: 20, offset: 0, sortBy: 'uploaded', sortOrder: 'desc' }, [])
            .select('d.id')
            .compile().sql;

        expect(searchSql.startsWith(filterSql)).toBe(true);
        expect(searchSql).toContain('order by "d"."created_at" desc');
        expect(searchSql).toContain('limit');
        expect(searchSql).toContain('offset');
    });

    it('sorts by ts_rank for relevance searches', () => {
        const { sql } = buildSearchQuery(documentJoins(), { fullText: 'beach' }, USER_ID, { limit: 20, offset: 0, sortBy: 'relevance', sortOrder: 'desc' }, [])
            .select('d.id')
            .compile();

        expect(sql).toContain('ts_rank(d.search_vector');
    });
});

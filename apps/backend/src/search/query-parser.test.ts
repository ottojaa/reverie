import { describe, expect, it } from 'vitest';
import { parseQuery } from './query-parser';

/**
 * Parity corpus for parseQuery().
 *
 * These tests pin the full ParsedQuery output for realistic queries across every
 * filter key. They guard the tokenizer swap (local tokenize() -> shared
 * tokenizeQuery()): tokenization changes must keep every case green.
 *
 * Relative dates stay unresolved ({ relative: '...' }) at parse time, and
 * absolute date forms produce deterministic Date objects, so toEqual is safe.
 */

/** Mirrors parseDateValue's month-range end computation (last day of end month). */
function endOfMonth(month: string): Date {
    const end = new Date(`${month}-01`);

    end.setMonth(end.getMonth() + 1);
    end.setDate(0);

    return end;
}

describe('parseQuery free text', () => {
    it('parses empty query to empty object', () => {
        expect(parseQuery('')).toEqual({});
    });

    it('treats bare * as match-all (no fullText)', () => {
        expect(parseQuery('*')).toEqual({});
    });

    it('parses plain free text', () => {
        expect(parseQuery('beach sunset')).toEqual({ fullText: 'beach sunset' });
    });

    it('merges quoted and unquoted text parts', () => {
        expect(parseQuery('"beach sunset" holiday')).toEqual({ fullText: 'beach sunset holiday' });
    });

    it('keeps negated quoted text as plain text (negation not applied to free text)', () => {
        expect(parseQuery('-"draft copy"')).toEqual({ fullText: 'draft copy' });
    });
});

describe('parseQuery in: scope', () => {
    it('parses in:filename', () => {
        expect(parseQuery('in:filename vacation')).toEqual({ searchScope: 'filename', fullText: 'vacation' });
    });

    it('parses in:content', () => {
        expect(parseQuery('in:content Apple')).toEqual({ searchScope: 'content', fullText: 'Apple' });
    });

    it('parses in:summary', () => {
        expect(parseQuery('in:summary tax')).toEqual({ searchScope: 'summary', fullText: 'tax' });
    });

    it('ignores unknown scopes', () => {
        expect(parseQuery('in:everything foo')).toEqual({ fullText: 'foo' });
    });
});

describe('parseQuery type:', () => {
    it('maps photo aliases to the photo type', () => {
        expect(parseQuery('type:photo')).toEqual({ types: ['photo'] });
        expect(parseQuery('type:images')).toEqual({ types: ['photo'] });
        expect(parseQuery('type:PHOTO')).toEqual({ types: ['photo'] });
    });

    it('maps document aliases to the canonical document type', () => {
        expect(parseQuery('type:document')).toEqual({ types: ['document'] });
        expect(parseQuery('type:doc')).toEqual({ types: ['document'] });
    });

    it('maps receipt aliases to the canonical receipt type', () => {
        expect(parseQuery('type:receipts')).toEqual({ types: ['receipt'] });
    });

    it('maps screenshot and video aliases', () => {
        expect(parseQuery('type:screenshots type:video')).toEqual({ types: ['screenshot', 'video'] });
    });

    it('passes unknown types through lowercased', () => {
        expect(parseQuery('type:Unknown')).toEqual({ types: ['unknown'] });
    });
});

describe('parseQuery format: and category:', () => {
    it('collects lowercased formats', () => {
        expect(parseQuery('format:PDF format:jpg')).toEqual({ formats: ['pdf', 'jpg'] });
    });

    it('collects lowercased categories', () => {
        expect(parseQuery('category:stock_statement category:Receipt')).toEqual({ categories: ['stock_statement', 'receipt'] });
    });
});

describe('parseQuery dates', () => {
    it('parses a single year', () => {
        expect(parseQuery('uploaded:2024')).toEqual({
            uploadedRange: { start: new Date('2024-01-01'), end: new Date('2024-12-31T23:59:59.999Z') },
        });
    });

    it('parses a year range', () => {
        expect(parseQuery('date:2022-2025')).toEqual({
            extractedDateRange: { start: new Date('2022-01-01'), end: new Date('2025-12-31T23:59:59.999Z') },
        });
    });

    it('parses a month range', () => {
        expect(parseQuery('uploaded:2024-01..2024-06')).toEqual({
            uploadedRange: { start: new Date('2024-01-01'), end: endOfMonth('2024-06') },
        });
    });

    it('parses a single date', () => {
        expect(parseQuery('date:2024-07-15')).toEqual({
            extractedDateRange: { start: new Date('2024-07-15'), end: new Date('2024-07-15T23:59:59.999Z') },
        });
    });

    it('parses relative dates case-insensitively', () => {
        expect(parseQuery('uploaded:last-week')).toEqual({ uploadedRange: { relative: 'last-week' } });
        expect(parseQuery('date:Yesterday')).toEqual({ extractedDateRange: { relative: 'yesterday' } });
    });

    it('parses invalid date values to an empty range', () => {
        expect(parseQuery('uploaded:not-a-date')).toEqual({ uploadedRange: {} });
    });
});

describe('parseQuery folder:', () => {
    it('collects folder paths and partial names', () => {
        expect(parseQuery('folder:/vacation/2024 folder:receipts')).toEqual({ folders: ['/vacation/2024', 'receipts'] });
    });
});

describe('parseQuery has:', () => {
    it('parses positive property filters', () => {
        expect(parseQuery('has:text has:summary has:thumbnail')).toEqual({ hasText: true, hasSummary: true, hasThumbnail: true });
    });
});

describe('parseQuery size:', () => {
    it('parses minimum size', () => {
        expect(parseQuery('size:>10MB')).toEqual({ sizeMin: 10 * 1024 * 1024 });
    });

    it('parses maximum size', () => {
        expect(parseQuery('size:<100KB')).toEqual({ sizeMax: 100 * 1024 });
    });

    it('parses exact size as an approximate range', () => {
        expect(parseQuery('size:5MB')).toEqual({ sizeMin: 5 * 1024 * 1024 * 0.9, sizeMax: 5 * 1024 * 1024 * 1.1 });
    });

    it('ignores unparseable sizes', () => {
        expect(parseQuery('size:huge')).toEqual({});
    });
});

describe('parseQuery tag:, entity:, company:, location:', () => {
    it('collects lowercased tags', () => {
        expect(parseQuery('tag:Important tag:tax')).toEqual({ tags: ['important', 'tax'] });
    });

    it('collects entities from entity: and company: preserving case', () => {
        expect(parseQuery('entity:Apple company:"John Smith"')).toEqual({ entities: ['Apple', 'John Smith'] });
    });

    it('parses a multi-word quoted filter value followed by free text', () => {
        expect(parseQuery('entity:"John Smith" report')).toEqual({ entities: ['John Smith'], fullText: 'report' });
    });

    it('collects locations preserving case', () => {
        expect(parseQuery('location:"New York" location:Italy')).toEqual({ locations: ['New York', 'Italy'] });
    });
});

describe('parseQuery negations', () => {
    it('parses -has:text as a negated property', () => {
        expect(parseQuery('-has:text')).toEqual({ negations: { hasText: false } });
    });

    it('parses -has:summary and -has:thumbnail', () => {
        expect(parseQuery('-has:summary -has:thumbnail')).toEqual({ negations: { hasSummary: false, hasThumbnail: false } });
    });

    it('parses negated types and formats', () => {
        expect(parseQuery('-type:photo -format:pdf')).toEqual({ negations: { types: ['photo'], formats: ['pdf'] } });
    });

    it('parses negated tags, categories and folders', () => {
        expect(parseQuery('-tag:archived -category:receipt -folder:trash')).toEqual({
            negations: { tags: ['archived'], categories: ['receipt'], folders: ['trash'] },
        });
    });
});

describe('parseQuery unknown filter keys', () => {
    it('treats unknown keys as free text', () => {
        expect(parseQuery('foo:bar')).toEqual({ fullText: 'foo:bar' });
    });

    it('mixes unknown keys into surrounding free text', () => {
        expect(parseQuery('report foo:bar 2024')).toEqual({ fullText: 'report foo:bar 2024' });
    });
});

describe('parseQuery combined queries', () => {
    it('parses a realistic mixed query', () => {
        expect(parseQuery('tax report type:photo tag:2024 folder:/inbox uploaded:last-month -has:summary')).toEqual({
            fullText: 'tax report',
            types: ['photo'],
            tags: ['2024'],
            folders: ['/inbox'],
            uploadedRange: { relative: 'last-month' },
            negations: { hasSummary: false },
        });
    });

    it('parses a financial document query', () => {
        expect(parseQuery('category:stock_statement entity:Nordea date:2022-2025 size:>1MB')).toEqual({
            categories: ['stock_statement'],
            entities: ['Nordea'],
            extractedDateRange: { start: new Date('2022-01-01'), end: new Date('2025-12-31T23:59:59.999Z') },
            sizeMin: 1024 * 1024,
        });
    });
});

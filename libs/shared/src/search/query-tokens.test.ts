import { describe, expect, it } from 'vitest';
import {
    addFilter,
    getFilterTokens,
    getFreeText,
    isKnownFilter,
    removeFilter,
    replaceFilter,
    serializeQuery,
    setFreeText,
    tokenizeQuery,
} from './query-tokens.js';

describe('tokenizeQuery', () => {
    it('tokenizes free text words', () => {
        expect(tokenizeQuery('beach sunset')).toEqual([
            { type: 'text', value: 'beach', negated: false, raw: 'beach' },
            { type: 'text', value: 'sunset', negated: false, raw: 'sunset' },
        ]);
    });

    it('tokenizes quoted free text', () => {
        expect(tokenizeQuery('"beach sunset"')).toEqual([{ type: 'quoted', value: 'beach sunset', negated: false, raw: '"beach sunset"' }]);
    });

    it('tokenizes filters and lowercases keys', () => {
        expect(tokenizeQuery('TYPE:photo')).toEqual([{ type: 'filter', key: 'type', value: 'photo', negated: false, raw: 'TYPE:photo' }]);
    });

    it('tokenizes negated filters', () => {
        expect(tokenizeQuery('-has:text')).toEqual([{ type: 'filter', key: 'has', value: 'text', negated: true, raw: '-has:text' }]);
    });

    it('handles quoted filter values with whitespace', () => {
        expect(tokenizeQuery('entity:"John Smith" beach')).toEqual([
            { type: 'filter', key: 'entity', value: 'John Smith', negated: false, raw: 'entity:"John Smith"' },
            { type: 'text', value: 'beach', negated: false, raw: 'beach' },
        ]);
    });

    it('handles single-word quoted filter values', () => {
        expect(tokenizeQuery('folder:"Seppo"')).toEqual([{ type: 'filter', key: 'folder', value: 'Seppo', negated: false, raw: 'folder:"Seppo"' }]);
    });

    it('consumes unterminated quotes to end of string', () => {
        expect(tokenizeQuery('"beach sun')).toEqual([{ type: 'quoted', value: 'beach sun', negated: false, raw: '"beach sun' }]);
        expect(tokenizeQuery('entity:"John Smi')).toEqual([{ type: 'filter', key: 'entity', value: 'John Smi', negated: false, raw: 'entity:"John Smi' }]);
    });

    it('keeps empty filter values', () => {
        expect(tokenizeQuery('tag:')).toEqual([{ type: 'filter', key: 'tag', value: '', negated: false, raw: 'tag:' }]);
    });

    it('treats a leading colon as text', () => {
        expect(tokenizeQuery(':value')).toEqual([{ type: 'text', value: ':value', negated: false, raw: ':value' }]);
    });

    it('preserves value case (semantic lowercasing is backend-side)', () => {
        expect(tokenizeQuery('tag:Important')[0]?.value).toBe('Important');
    });

    it('handles date and size values as opaque strings', () => {
        expect(tokenizeQuery('uploaded:2024-01..2024-06 size:>10MB')).toEqual([
            { type: 'filter', key: 'uploaded', value: '2024-01..2024-06', negated: false, raw: 'uploaded:2024-01..2024-06' },
            { type: 'filter', key: 'size', value: '>10MB', negated: false, raw: 'size:>10MB' },
        ]);
    });
});

describe('serializeQuery', () => {
    it('round-trips exactly (raw preservation)', () => {
        const queries = [
            'beach type:photo -has:text',
            'entity:"John Smith" tag:tax uploaded:last-week',
            '"exact phrase" folder:/vacation/2024',
            'type:photo type:video size:>10MB',
        ];

        for (const q of queries) {
            expect(serializeQuery(tokenizeQuery(q))).toBe(q);
        }
    });

    it('is stable on a second pass', () => {
        const q = 'beach   type:photo    entity:"John Smith"';
        const once = serializeQuery(tokenizeQuery(q));

        expect(serializeQuery(tokenizeQuery(once))).toBe(once);
    });
});

describe('isKnownFilter / getFreeText / getFilterTokens', () => {
    it('marks unknown keys as free text', () => {
        const tokens = tokenizeQuery('beach foo:bar type:photo');

        expect(isKnownFilter(tokens[1]!)).toBe(false);
        expect(getFreeText(tokens)).toBe('beach foo:bar');
        expect(getFilterTokens(tokens).map((t) => t.key)).toEqual(['type']);
    });

    it('excludes bare * from free text', () => {
        expect(getFreeText(tokenizeQuery('* type:photo'))).toBe('');
    });

    it('filters tokens by key', () => {
        const tokens = tokenizeQuery('tag:a tag:b type:photo');

        expect(getFilterTokens(tokens, 'tag').map((t) => t.value)).toEqual(['a', 'b']);
    });

    it('recognizes the content filter key (not free text)', () => {
        const tokens = tokenizeQuery('content:"invoice number" beach');

        expect(isKnownFilter(tokens[0]!)).toBe(true);
        expect(getFreeText(tokens)).toBe('beach');
        expect(getFilterTokens(tokens, 'content').map((t) => t.value)).toEqual(['invoice number']);
    });
});

describe('addFilter', () => {
    it('appends a filter token', () => {
        expect(addFilter('beach', 'type', 'photo')).toBe('beach type:photo');
    });

    it('quotes values with whitespace', () => {
        expect(addFilter('', 'entity', 'John Smith')).toBe('entity:"John Smith"');
    });

    it('dedupes identical tokens', () => {
        expect(addFilter('type:photo', 'type', 'photo')).toBe('type:photo');
    });

    it('adds negated tokens distinctly', () => {
        expect(addFilter('has:text', 'has', 'text', { negated: true })).toBe('has:text -has:text');
    });
});

describe('removeFilter', () => {
    it('removes by key and value at token level', () => {
        expect(removeFilter('tag:tax entity:"tax office"', 'tag', 'tax')).toBe('entity:"tax office"');
    });

    it('does not substring-match across keys (format:pdf vs tag:pdf)', () => {
        expect(removeFilter('tag:pdf format:pdf', 'tag', 'pdf')).toBe('format:pdf');
    });

    it('removes all tokens of a key when value omitted', () => {
        expect(removeFilter('tag:a tag:b beach', 'tag')).toBe('beach');
    });

    it('matches values case-insensitively', () => {
        expect(removeFilter('folder:Seppo', 'folder', 'seppo')).toBe('');
    });
});

describe('replaceFilter', () => {
    it('replaces all tokens of a key with one value', () => {
        expect(replaceFilter('uploaded:2024 beach', 'uploaded', 'last-week')).toBe('beach uploaded:last-week');
    });
});

describe('setFreeText', () => {
    it('replaces free text and preserves filters', () => {
        expect(setFreeText('beach type:photo', 'sunset')).toBe('sunset type:photo');
    });

    it('clears free text when empty', () => {
        expect(setFreeText('beach type:photo', '')).toBe('type:photo');
    });

    it('lifts filter syntax typed into the text', () => {
        expect(setFreeText('type:photo', 'beach tag:summer')).toBe('beach tag:summer type:photo');
    });

    it('drops unknown-key pseudo filters with the old text', () => {
        expect(setFreeText('foo:bar type:photo', 'beach')).toBe('beach type:photo');
    });
});

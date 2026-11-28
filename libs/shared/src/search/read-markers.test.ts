import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getFilterTokens, getFreeText, serializeQuery, setFreeText, tokenizeQuery } from './query-tokens.js';
import { buildReadMarker, getReadKeys, toReadMarker, toSearchedTokens } from './read-markers.js';

// The Android port runs the same file (QueryTokensTest.kt)
const FIXTURE = new URL('../fixtures/search-read-markers.json', import.meta.url);

interface Fixture {
    queries: { name: string; q: string; freeText: string; filters: string[]; readKeys: string[] }[];
    setFreeText: { name: string; q: string; text: string; result: string }[];
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;

describe('read markers, shared with Android', () => {
    it.each(fixture.queries)('$name', ({ q, freeText, filters, readKeys }) => {
        const tokens = tokenizeQuery(q);

        expect(getFreeText(tokens)).toBe(freeText);
        expect(getFilterTokens(tokens).map((token) => token.raw)).toEqual(filters);
        expect([...getReadKeys(tokens)]).toEqual(readKeys);
    });

    it.each(fixture.setFreeText)('setFreeText: $name', ({ q, text, result }) => {
        expect(setFreeText(q, text)).toBe(result);
    });
});

describe('buildReadMarker', () => {
    it('is read back after a round trip through the query string', () => {
        const q = serializeQuery([buildReadMarker('date', '2026-10', ['viime', 'kuussa'])]);

        expect(q).toBe('read:"date:2026-10 viime kuussa"');
        expect(tokenizeQuery(q).map(toReadMarker)).toEqual([{ key: 'date', value: '2026-10', words: ['viime', 'kuussa'] }]);
    });
});

describe('toSearchedTokens', () => {
    const toSearched = (q: string) => serializeQuery(toSearchedTokens(tokenizeQuery(q)));

    it('takes the words out once, leaving a second mention', () => {
        expect(toSearched('kuitit kuitit type:receipt read:"type:receipt kuitit"')).toBe('kuitit type:receipt');
    });

    it('leaves quoted words in', () => {
        expect(toSearched('"kuitit" kuitit type:receipt read:"type:receipt kuitit"')).toBe('"kuitit" type:receipt');
    });
});

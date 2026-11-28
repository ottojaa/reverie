import { describe, expect, it } from 'vitest';
import type { RankedEntry } from '../hybrid-search';
import { mergeSearches } from './merge';

const toEntries = (ids: string[], match: RankedEntry['match'] = null): RankedEntry[] => ids.map((id) => ({ id, wordRank: 1, createdAt: 0, match }));
const range = (prefix: string, length: number) => Array.from({ length }, (_, index) => prefix + String(index).padStart(2, '0'));
const idsOf = (entries: RankedEntry[]) => entries.map((entry) => entry.id);

describe('mergeSearches', () => {
    it('ranks a document several searches found above one only a single search found', () => {
        const merged = idsOf(mergeSearches(toEntries(['a', 'b', 'd']), [toEntries(['c', 'd'])], 24));

        // 'a' and 'c' have their guaranteed places; of the rest, the one both searches found comes first.
        expect(merged).toEqual(['a', 'c', 'd', 'b']);
    });

    it('gives a rewording’s own find a place although a full page of documents outscores it', () => {
        const page = range('plain', 24);
        // Each rewording agrees with the user's search on the whole page, and one also finds the target, second.
        const found = toEntries([page[0]!, 'target', ...page.slice(1)]);
        const merged = idsOf(mergeSearches(toEntries(page), [found, toEntries(page)], 24));

        expect(merged).toHaveLength(24);
        expect(merged).toContain('target');
    });

    it('gives each rewording its own place, and the user’s best hit one', () => {
        const page = range('plain', 24);
        const own = toEntries(['mine', ...page]);
        const rewordings = ['x', 'y', 'z'].map((find) => toEntries([...page, find]));
        const merged = idsOf(mergeSearches(own, rewordings, 4));

        expect([...merged].sort()).toEqual(['mine', 'x', 'y', 'z']);
    });

    it('combines why a document matched across the searches that found it', () => {
        const merged = mergeSearches(toEntries(['a'], 'keywords'), [toEntries(['a', 'b'], 'meaning')], 24);

        expect(merged.map((entry) => [entry.id, entry.match])).toEqual([
            ['a', 'both'],
            ['b', 'meaning'],
        ]);
    });

    it('says which search ranked each document best, the user’s own being the first', () => {
        const merged = mergeSearches(toEntries(['a', 'b', 'c']), [toEntries(['b', 'd']), toEntries(['d', 'c'])], 24);

        expect(Object.fromEntries(merged.map((entry) => [entry.id, entry.foundBy]))).toEqual({ a: 0, b: 1, c: 2, d: 2 });
    });

    it('prefers, of equal ranks, a search whose words matched, and then the earlier one', () => {
        const merged = mergeSearches(toEntries(['a'], 'meaning'), [toEntries(['a'], 'both'), toEntries(['a'], 'keywords')], 24);

        expect(merged.map((entry) => entry.foundBy)).toEqual([1]);
    });

    it('is empty when nothing was found', () => {
        expect(mergeSearches([], [[]], 24)).toEqual([]);
    });
});

import { describe, expect, it } from 'vitest';
import { placeFolders } from './folder-placement';
import type { RankedEntry } from './hybrid-search';

const doc = (id: string, wordRank: number, match: RankedEntry['match'] = 'keywords'): RankedEntry => ({ id, wordRank, createdAt: 0, match });
const folder = (id: string, relevance: number) => ({ id, relevance, created_at: new Date(0) });
const ids = (placed: ReturnType<typeof placeFolders<ReturnType<typeof folder>>>) =>
    placed.map((item) => (item.type === 'document' ? item.entry.id : item.folder.id));

describe('placeFolders', () => {
    it('puts a folder before the first document with a lower word rank, and the rest after the last', () => {
        expect(ids(placeFolders([doc('a', 0.5), doc('b', 0.2)], [folder('f', 0.3), folder('g', 0.01)]))).toEqual(['a', 'f', 'b', 'g']);
    });

    it('does not let a meaning-only document in the middle pull a folder ahead of later word matches', () => {
        const docs = [doc('a', 0.5), doc('m', 0, 'meaning'), doc('b', 0.4), doc('c', 0.3)];

        expect(ids(placeFolders(docs, [folder('f', 0.1)]))).toEqual(['a', 'm', 'b', 'c', 'f']);
    });

    it('still lets a folder outrank a document the meaning also found', () => {
        expect(ids(placeFolders([doc('a', 0.2, 'both')], [folder('f', 0.9)]))).toEqual(['f', 'a']);
    });
});

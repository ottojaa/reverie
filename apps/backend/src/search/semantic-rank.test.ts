import { expect, it } from 'vitest';
import { fuseRankings } from './semantic-rank';

const fuse = (input: { fullText?: string[]; text?: string[]; image?: string[] }, words: string[] = input.fullText ?? []) =>
    fuseRankings({ fullText: input.fullText ?? [], text: input.text ?? [], image: input.image ?? [] }, new Set(words));

it('keeps full-text order when nothing matches by meaning', () => {
    expect(fuse({ fullText: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c']);
});

it('puts a word match ahead of a document that tops both meaning streams (equal score, the words break the tie)', () => {
    expect(fuse({ fullText: ['exact'], text: ['loose'], image: ['loose'] }, ['exact'])).toEqual(['exact', 'loose']);
});

it('lets agreement between the streams lift a document over better word matches, and a word match win a tie', () => {
    expect(fuse({ fullText: ['a', 'b', 'c'], text: ['x', 'c'], image: ['x', 'c'] })).toEqual(['c', 'a', 'x', 'b']);
});

it('ranks a document found by words and meaning above one found by words alone', () => {
    expect(fuse({ fullText: ['a', 'b'], text: ['b'] })).toEqual(['b', 'a']);
});

it('breaks full ties by id so the order is the same on every page', () => {
    expect(fuse({ text: ['b'], image: ['a'] }, [])).toEqual(['a', 'b']);
});

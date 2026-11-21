import { describe, expect, it } from 'vitest';
import { clusterCompleteLinkage, type SimilarPair } from './clustering';

const pair = (a: string, b: string, similarity: number): SimilarPair => ({ a, b, similarity });

describe('clusterCompleteLinkage', () => {
    it('joins images that are all similar to each other', () => {
        const clusters = clusterCompleteLinkage([pair('a', 'b', 0.99), pair('a', 'c', 0.97), pair('b', 'c', 0.98)]);

        expect(clusters).toEqual([{ ids: ['a', 'b', 'c'], minSimilarity: 0.97 }]);
    });

    it('does not chain: a~b and b~c without a~c never make {a,b,c}', () => {
        const clusters = clusterCompleteLinkage([pair('a', 'b', 0.99), pair('b', 'c', 0.96)]);

        expect(clusters).toEqual([{ ids: ['a', 'b'], minSimilarity: 0.99 }]);
    });

    it('lets the stronger pair win when an image could join either side, whatever the order of the pairs', () => {
        const pairs = [pair('a', 'b', 0.96), pair('b', 'c', 0.99)];

        expect(clusterCompleteLinkage(pairs)).toEqual(clusterCompleteLinkage([...pairs].reverse()));
        expect(clusterCompleteLinkage(pairs)).toEqual([{ ids: ['b', 'c'], minSimilarity: 0.99 }]);
    });

    it('merges two groups only when every image of one is similar to every image of the other', () => {
        const pairs = [pair('a', 'b', 0.99), pair('c', 'd', 0.99), pair('a', 'c', 0.97), pair('b', 'd', 0.97), pair('a', 'd', 0.96)];

        // b~c is missing, so {a,b} and {c,d} stay apart.
        expect(clusterCompleteLinkage(pairs).map((cluster) => cluster.ids)).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
        expect(clusterCompleteLinkage([...pairs, pair('b', 'c', 0.95)]).map((cluster) => cluster.ids)).toEqual([['a', 'b', 'c', 'd']]);
    });

    it('uses the strongest of two pairs between the same images, and returns no single images', () => {
        expect(clusterCompleteLinkage([pair('a', 'b', 0.9), pair('b', 'a', 1)])).toEqual([{ ids: ['a', 'b'], minSimilarity: 1 }]);
        expect(clusterCompleteLinkage([])).toEqual([]);
    });

    it('lists the biggest group first', () => {
        const clusters = clusterCompleteLinkage([pair('a', 'b', 1), pair('c', 'd', 0.99), pair('c', 'e', 0.99), pair('d', 'e', 0.99)]);

        expect(clusters.map((cluster) => cluster.ids)).toEqual([
            ['c', 'd', 'e'],
            ['a', 'b'],
        ]);
    });
});

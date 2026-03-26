import { describe, expect, it } from 'vitest';
import { filterDocumentIdsNeedingMove } from './organize.service';

describe('filterDocumentIdsNeedingMove', () => {
    it('drops ids whose folder already matches target', () => {
        const target = 'folder-uuid-1';
        const map = new Map<string, string | null>([
            ['a', target],
            ['b', 'other-folder'],
            ['c', null],
        ]);

        expect(filterDocumentIdsNeedingMove(['a', 'b', 'c'], map, target)).toEqual(['b', 'c']);
    });

    it('returns empty when all documents are already in target', () => {
        const target = 'f1';
        const map = new Map<string, string | null>([
            ['a', 'f1'],
            ['b', 'f1'],
        ]);

        expect(filterDocumentIdsNeedingMove(['a', 'b'], map, target)).toEqual([]);
    });
});

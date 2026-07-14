import type { FolderWithChildren } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { computeIslandLayout, islandRadius } from './computeIslandLayout.js';

function folder(overrides: Partial<FolderWithChildren> & { id: string }): FolderWithChildren {
    return {
        parent_id: null,
        name: 'Folder ' + overrides.id,
        path: '/' + overrides.id,
        description: null,
        emoji: null,
        sort_order: 0,
        type: 'folder',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        children: [],
        document_count: 10,
        ...overrides,
    };
}

const tree: FolderWithChildren[] = [
    folder({
        id: 'c1',
        type: 'collection',
        name: 'Taxes',
        sort_order: 0,
        children: [
            folder({ id: 'f1', sort_order: 0, document_count: 40 }),
            folder({ id: 'f2', sort_order: 1, children: [folder({ id: 'f3', sort_order: 0 })] }),
        ],
    }),
    folder({ id: 'c2', type: 'collection', name: 'House', sort_order: 1, children: [folder({ id: 'f4', sort_order: 0 })] }),
    folder({ id: 'f5', sort_order: 2, document_count: 0 }),
];

describe('computeIslandLayout', () => {
    it('is deterministic for the same tree', () => {
        expect(computeIslandLayout(tree)).toEqual(computeIslandLayout(tree));
    });

    it('creates one island per folder, flattening nested folders into their collection cluster', () => {
        const islands = computeIslandLayout(tree);
        const byId = new Map(islands.map((i) => [i.id, i]));

        expect(islands).toHaveLength(5);
        expect(byId.get('f1')?.collectionId).toBe('c1');
        expect(byId.get('f3')?.collectionId).toBe('c1');
        expect(byId.get('f4')?.collectionId).toBe('c2');
    });

    it('groups loose top-level folders into a synthetic cluster without a collection', () => {
        const islands = computeIslandLayout(tree);
        const loose = islands.find((i) => i.id === 'f5');

        expect(loose?.collectionId).toBeNull();
        expect(loose?.collectionName).toBeNull();
    });

    it('never overlaps islands', () => {
        const islands = computeIslandLayout(tree);

        for (let a = 0; a < islands.length; a++) {
            for (let b = a + 1; b < islands.length; b++) {
                const ia = islands[a]!;
                const ib = islands[b]!;
                const d = Math.hypot(ia.position.x - ib.position.x, ia.position.z - ib.position.z);

                expect(d).toBeGreaterThan(Math.max(ia.radius, ib.radius));
            }
        }
    });

    it('scales island radius with document count, capped', () => {
        expect(islandRadius(0)).toBeLessThan(islandRadius(100));
        expect(islandRadius(100000)).toBeLessThanOrEqual(6);
    });

    it('returns an empty layout for an empty tree', () => {
        expect(computeIslandLayout([])).toEqual([]);
    });
});

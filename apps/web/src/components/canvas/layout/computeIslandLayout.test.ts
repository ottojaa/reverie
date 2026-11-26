import type { FolderWithChildren } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { computeIslandLayout, ISLAND_RADIUS } from './computeIslandLayout.js';

function folder(overrides: Partial<FolderWithChildren> & { id: string; files?: number }): FolderWithChildren {
    const { files = 10, children = [], ...fields } = overrides;
    // A node's counts cover its whole subtree.
    const total = children.reduce((sum, child) => sum + child.kind_counts.file, files);

    return {
        parent_id: null,
        name: 'Folder ' + overrides.id,
        path: '/' + overrides.id,
        description: null,
        emoji: null,
        sort_order: 0,
        is_private: false,
        lock_id: null,
        locked: false,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        children,
        kind_counts: { image: 0, video: 0, file: total },
        cover: null,
        ...fields,
    };
}

const tree: FolderWithChildren[] = [
    folder({
        id: 't1',
        name: 'Taxes',
        sort_order: 0,
        children: [folder({ id: 'f2', sort_order: 1, children: [folder({ id: 'f3', files: 4 })] }), folder({ id: 'f1', sort_order: 0, files: 40 })],
    }),
    folder({ id: 't2', name: 'House', sort_order: 1, children: [folder({ id: 'f4' })] }),
    folder({ id: 't3', sort_order: 2, files: 0 }),
];

describe('computeIslandLayout', () => {
    it('is deterministic for the same tree', () => {
        expect(computeIslandLayout(tree)).toEqual(computeIslandLayout(tree));
    });

    it('gives every folder an island, clustered under its top-level folder', () => {
        const islands = computeIslandLayout(tree);

        expect(islands.map((i) => [i.id, i.clusterId])).toEqual([
            ['t1', 't1'],
            ['f1', 't1'],
            ['f2', 't1'],
            ['f3', 't1'],
            ['t2', 't2'],
            ['f4', 't2'],
            ['t3', 't3'],
        ]);
        expect(islands.find((i) => i.id === 'f3')?.clusterName).toBe('Taxes');
    });

    it("counts only a folder's own documents on its island", () => {
        const counts = new Map(computeIslandLayout(tree).map((i) => [i.id, i.documentCount]));

        expect(counts.get('t1')).toBe(10);
        expect(counts.get('f2')).toBe(10);
        expect(counts.get('f3')).toBe(4);
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

    it('gives every island the same radius regardless of document count', () => {
        const islands = computeIslandLayout(tree);

        expect(new Set(islands.map((i) => i.radius))).toEqual(new Set([ISLAND_RADIUS]));
    });

    it('lines cluster folders up left to right on a shared row', () => {
        const t1 = computeIslandLayout(tree).filter((i) => i.clusterId === 't1');

        // ≤5 folders → a single row: identical z, strictly increasing x.
        expect(new Set(t1.map((i) => i.position.z)).size).toBe(1);

        const xs = t1.map((i) => i.position.x);

        expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    });

    it('wraps rows after five folders, keeping rows aligned', () => {
        const many = [folder({ id: 'big', children: Array.from({ length: 6 }, (_, i) => folder({ id: 'm' + i, sort_order: i })) })];
        const zs = new Set(computeIslandLayout(many).map((i) => i.position.z));

        expect(zs.size).toBe(2);
    });

    it('returns an empty layout for an empty tree', () => {
        expect(computeIslandLayout([])).toEqual([]);
    });
});

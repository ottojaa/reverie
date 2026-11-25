import { describe, expect, it } from 'vitest';
import { toFolderTree, type FolderNode, type FolderTree } from './snapshot.js';

/** A small seeded generator, so a failing forest can be rebuilt from its seed. */
function createRandom(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function toNode(id: number, parent: number | null, extra: Partial<FolderNode> = {}): FolderNode {
    return {
        id: 'f' + id,
        parent_id: parent === null ? null : 'f' + parent,
        name: 'folder ' + id,
        sort_order: 0,
        is_private: false,
        deleted_at: null,
        ...extra,
    };
}

/** Folders whose parent is any earlier one (so depth varies and chains grow long), shuffled. */
function createForest(seed: number): FolderNode[] {
    const random = createRandom(seed);
    const size = 1 + Math.floor(random() * 40);
    const nodes = Array.from({ length: size }, (_, i) => {
        const parent = i === 0 || random() < 0.2 ? null : i - 1 - Math.floor(random() ** 3 * i);

        return toNode(i, parent, {
            is_private: random() < 0.15,
            deleted_at: random() < 0.1 ? new Date(0) : null,
            sort_order: Math.floor(random() * 3),
        });
    });

    return nodes.sort(() => random() - 0.5);
}

/** The folder and everything above it, walked the naive way. */
function chainOf(byId: Map<string, FolderNode>, node: FolderNode): FolderNode[] {
    const parent = node.parent_id === null ? undefined : byId.get(node.parent_id);

    return parent ? [...chainOf(byId, parent), node] : [node];
}

function expectForestRules(nodes: FolderNode[], tree: FolderTree<FolderNode>): void {
    const byId = new Map(nodes.map((node) => [node.id, node]));

    for (const node of nodes) {
        const chain = chainOf(byId, node);
        const outermost = chain.find((folder) => folder.is_private)?.id ?? null;

        expect(tree.lockOf(node.id)).toBe(outermost);
        expect(tree.ancestors(node.id).map((folder) => folder.id)).toEqual(chain.slice(0, -1).map((folder) => folder.id));

        if (!node.is_private) continue;

        for (const below of tree.subtree(node.id, { trashed: true })) expect(tree.lockOf(below.id)).toBe(outermost);
    }
}

describe('toFolderTree', () => {
    it('locks everything beneath a private folder with the outermost private ancestor, on random forests', () => {
        for (let seed = 1; seed <= 500; seed++) {
            const nodes = createForest(seed);

            expectForestRules(nodes, toFolderTree(nodes));
        }
    });

    it('returns a subtree parents first, holding exactly the folders that have the root above them', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const nodes = createForest(seed);
            const tree = toFolderTree(nodes);

            for (const node of nodes) {
                const ids = tree.subtree(node.id, { trashed: true }).map((folder) => folder.id);
                const below = nodes.filter((other) => other.id === node.id || tree.ancestors(other.id).some((folder) => folder.id === node.id));

                expect([...ids].sort()).toEqual(below.map((folder) => folder.id).sort());

                for (const id of ids.slice(1)) expect(ids.indexOf(tree.folder(id)!.parent_id!)).toBeLessThan(ids.indexOf(id));
            }
        }
    });

    it('lists live children in sibling order and leaves out what is only reachable through the trash', () => {
        const tree = toFolderTree([
            toNode(1, null),
            toNode(2, 1, { sort_order: 1, name: 'b' }),
            toNode(3, 1, { sort_order: 0, name: 'z' }),
            toNode(4, 1, { sort_order: 1, name: 'a' }),
            toNode(5, 1, { deleted_at: new Date(0) }),
            toNode(6, 5),
        ]);

        expect(tree.children('f1').map((folder) => folder.id)).toEqual(['f3', 'f4', 'f2']);
        expect(tree.subtree('f1').map((folder) => folder.id)).toEqual(['f1', 'f3', 'f4', 'f2']);
        expect(tree.subtree('f1', { trashed: true })).toHaveLength(6);
        expect(tree.subtree('f5')).toEqual([]);
    });

    it('ends on a parent loop and keeps every folder in it private', () => {
        const tree = toFolderTree([toNode(1, 2), toNode(2, 3, { is_private: true }), toNode(3, 1)]);

        expect(tree.subtree('f1')).toHaveLength(3);
        expect(tree.ancestors('f1')).toHaveLength(2);

        for (const id of ['f1', 'f2', 'f3']) expect(tree.lockOf(id)).toBe('f2');
    });

    it('knows nothing about an unknown folder', () => {
        const tree = toFolderTree([toNode(1, null)]);

        expect(tree.folder('nope')).toBeUndefined();
        expect(tree.lockOf('nope')).toBeNull();
        expect(tree.subtree('nope')).toEqual([]);
    });
});

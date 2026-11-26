import { FolderTreeResponseSchema } from '@reverie/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planMove } from './move.js';
import { moveInTree, patchInTree, reorderTree } from './tree-edits.js';
import { findFolder, flattenTree } from './tree.js';

// Photos { Surprise party, Trips { Norway } }, Receipts, Taxes { Statements }
const tree = FolderTreeResponseSchema.parse(
    JSON.parse(readFileSync(new URL('../../../../../libs/shared/src/fixtures/folder-tree.json', import.meta.url), 'utf8')),
);

function toId(name: string): string {
    const row = flattenTree(tree).find(({ folder }) => folder.name === name);

    if (!row) throw new Error('No folder in the fixture: ' + name);

    return row.folder.id;
}

function toOrder(...names: string[]) {
    return names.map((name, sort_order) => ({ id: toId(name), sort_order }));
}

describe('planMove', () => {
    it('nests a folder inside another, at any depth', () => {
        expect(planMove(tree, toId('Receipts'), { zone: 'into', targetId: toId('Norway') })).toEqual({ parentId: toId('Norway') });
    });

    it('moves a deep folder to the top level', () => {
        expect(planMove(tree, toId('Norway'), { zone: 'top' })).toEqual({ parentId: null });
    });

    it('moves and places a folder next to one on another level', () => {
        expect(planMove(tree, toId('Norway'), { zone: 'before', targetId: toId('Receipts') })).toEqual({
            parentId: null,
            order: toOrder('Photos', 'Norway', 'Receipts', 'Taxes'),
        });
    });

    it('only reorders among siblings', () => {
        expect(planMove(tree, toId('Receipts'), { zone: 'before', targetId: toId('Photos') })).toEqual({
            order: toOrder('Receipts', 'Photos', 'Taxes'),
        });
    });

    it('changes nothing when the folder is already there', () => {
        expect(planMove(tree, toId('Receipts'), { zone: 'after', targetId: toId('Photos') })).toBeNull();
        expect(planMove(tree, toId('Norway'), { zone: 'into', targetId: toId('Trips') })).toBeNull();
        expect(planMove(tree, toId('Photos'), { zone: 'top' })).toBeNull();
    });

    it('refuses to put a folder inside itself', () => {
        expect(planMove(tree, toId('Photos'), { zone: 'into', targetId: toId('Photos') })).toBeNull();
        expect(planMove(tree, toId('Photos'), { zone: 'into', targetId: toId('Norway') })).toBeNull();
        expect(planMove(tree, toId('Photos'), { zone: 'before', targetId: toId('Norway') })).toBeNull();
    });
});

describe('optimistic tree edits', () => {
    it('moves a folder to the end of another one without touching the original', () => {
        const next = moveInTree(tree, toId('Norway'), toId('Receipts'));

        expect(findFolder(next, toId('Receipts'))?.children.map((folder) => folder.name)).toEqual(['Norway']);
        expect(findFolder(next, toId('Trips'))?.children).toEqual([]);
        expect(findFolder(tree, toId('Trips'))?.children).toHaveLength(1);
    });

    it('moves a folder to the top level', () => {
        const next = moveInTree(tree, toId('Norway'), null);

        expect(next.at(-1)?.name).toBe('Norway');
        expect(next.at(-1)?.parent_id).toBeNull();
    });

    it('reorders a level and renames a deep folder', () => {
        expect(reorderTree(tree, toOrder('Taxes', 'Receipts', 'Photos')).map((folder) => folder.name)).toEqual(['Taxes', 'Receipts', 'Photos']);
        expect(findFolder(patchInTree(tree, toId('Norway'), { name: 'Fjords' }), toId('Norway'))?.name).toBe('Fjords');
    });
});

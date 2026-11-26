import { FolderTreeResponseSchema, type FolderWithChildren } from '@reverie/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasOtherLockBelow, isInheritedPrivate, toFolderLockState, toPublicTree } from './privacy.js';
import { flattenTree } from './tree.js';

// Photos { Surprise party (private, locked), Trips { Norway } }, Receipts, Taxes (private, open) { Statements }
const tree = FolderTreeResponseSchema.parse(
    JSON.parse(readFileSync(new URL('../../../../../libs/shared/src/fixtures/folder-tree.json', import.meta.url), 'utf8')),
);

function byName(name: string): FolderWithChildren {
    const row = flattenTree(tree).find(({ folder }) => folder.name === name);

    if (!row) throw new Error('No folder in the fixture: ' + name);

    return row.folder;
}

describe('toFolderLockState', () => {
    it.each([
        ['a closed padlock for a locked folder', { is_private: true, locked: true }, 'locked'],
        ['an open padlock for a private folder whose lock is open', { is_private: true, locked: false }, 'unlocked'],
        ['nothing for a public folder', { is_private: false, locked: false }, 'none'],
        ['a closed padlock for a folder locked through one above it', { is_private: false, locked: true }, 'locked'],
    ])('shows %s', (_label, folder, state) => {
        expect(toFolderLockState(folder)).toBe(state);
    });
});

describe('isInheritedPrivate', () => {
    it('holds under a private folder', () => {
        expect(isInheritedPrivate(byName('Statements'))).toBe(true);
    });

    it('holds for a folder with its own flag too: the private folder above keeps it private', () => {
        expect(isInheritedPrivate({ ...byName('Statements'), is_private: true })).toBe(true);
    });

    it('does not hold for the outermost private folder or a public one', () => {
        expect(isInheritedPrivate(byName('Taxes'))).toBe(false);
        expect(isInheritedPrivate(byName('Norway'))).toBe(false);
    });
});

describe('the tree around a lock', () => {
    it('drops private folders and everything inside them from the public tree', () => {
        expect(flattenTree(toPublicTree(tree)).map(({ folder }) => folder.name)).toEqual(['Photos', 'Trips', 'Norway', 'Receipts']);
    });

    it('knows when a folder holds another lock', () => {
        expect(hasOtherLockBelow(byName('Photos'))).toBe(true);
        expect(hasOtherLockBelow(byName('Taxes'))).toBe(false);
    });
});

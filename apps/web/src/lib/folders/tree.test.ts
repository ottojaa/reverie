import { FolderTreeResponseSchema, type FolderWithChildren } from '@reverie/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toDeleteFolderMessage, toMakePrivateMessage } from './confirm-text.js';
import {
    findFolder,
    findFolderChain,
    flattenTree,
    isInheritedPrivate,
    searchTree,
    toIndent,
    toOwnCount,
    toPublicTree,
    toTotalCount,
    type FolderRow,
} from './tree.js';

// Photos { Surprise party (private, locked), Trips { Norway } }, Receipts, Taxes (private, open) { Statements }
const tree = FolderTreeResponseSchema.parse(
    JSON.parse(readFileSync(new URL('../../../../../libs/shared/src/fixtures/folder-tree.json', import.meta.url), 'utf8')),
);

function byName(name: string): FolderWithChildren {
    const row = flattenTree(tree).find(({ folder }) => folder.name === name);

    if (!row) throw new Error('No folder in the fixture: ' + name);

    return row.folder;
}

function toLines(rows: FolderRow[]): string[] {
    return rows.map(({ folder, depth }) => `${depth} ${folder.name}`);
}

describe('flattenTree', () => {
    it('lists every folder before its subfolders, with its depth', () => {
        expect(toLines(flattenTree(tree))).toEqual(['0 Photos', '1 Surprise party', '1 Trips', '2 Norway', '0 Receipts', '0 Taxes', '1 Statements']);
    });

    it('leaves out the subfolders of a closed folder', () => {
        const rows = flattenTree(tree, (folder) => folder.name !== 'Trips');

        expect(toLines(rows)).not.toContain('2 Norway');
        expect(toLines(rows)).toContain('1 Trips');
    });
});

describe('searchTree', () => {
    it('keeps the folders on the way to a deep match', () => {
        expect(toLines(searchTree(tree, 'norw'))).toEqual(['0 Photos', '1 Trips', '2 Norway']);
    });

    it('keeps everything in a matching folder', () => {
        expect(toLines(searchTree(tree, ' TRIPS '))).toEqual(['0 Photos', '1 Trips', '2 Norway']);
    });

    it('is empty when nothing matches', () => {
        expect(searchTree(tree, 'nothing like it')).toEqual([]);
    });
});

describe('finding folders', () => {
    it('gives the folder with every folder above it', () => {
        expect(findFolderChain(tree, byName('Norway').id).map((folder) => folder.name)).toEqual(['Photos', 'Trips', 'Norway']);
    });

    it('finds nothing for a missing or empty id', () => {
        expect(findFolder(tree, 'missing')).toBeNull();
        expect(findFolder(tree, null)).toBeNull();
        expect(findFolderChain(tree, 'missing')).toEqual([]);
    });
});

describe('privacy', () => {
    it('drops private folders and everything inside them from the public tree', () => {
        expect(toLines(flattenTree(toPublicTree(tree)))).toEqual(['0 Photos', '1 Trips', '2 Norway', '0 Receipts']);
    });

    it('marks a folder under a private one as private by inheritance', () => {
        expect(isInheritedPrivate(byName('Statements'))).toBe(true);
        expect(isInheritedPrivate(byName('Taxes'))).toBe(false);
        expect(isInheritedPrivate(byName('Norway'))).toBe(false);
    });
});

describe('counts', () => {
    it('totals a subtree without what sits behind another lock', () => {
        expect(toTotalCount(byName('Photos'))).toBe(4);
        expect(toTotalCount(byName('Surprise party'))).toBe(0);
    });

    it("separates a folder's own documents from its subfolders'", () => {
        expect(toOwnCount(byName('Photos'))).toBe(1);
        expect(toOwnCount(byName('Trips'))).toBe(0);
        expect(toOwnCount(byName('Norway'))).toBe(3);
        expect(toOwnCount(byName('Taxes'))).toBe(1);
    });
});

describe('toIndent', () => {
    it('stops growing after four levels', () => {
        expect(toIndent(4)).toBeGreaterThan(toIndent(3));
        expect(toIndent(20)).toBe(toIndent(4));
    });
});

describe('confirmation texts', () => {
    it('says how many files go to the trash, without counting private ones', () => {
        expect(toDeleteFolderMessage(byName('Photos'))).toBe(
            '"Photos" will be moved to Trash with its subfolders. 4 files go to the trash with it. So does everything in its private folders. You can restore it from Trash.',
        );
    });

    it('speaks of one file and no subfolders', () => {
        expect(toDeleteFolderMessage(byName('Statements'))).toBe(
            '"Statements" will be moved to Trash. 1 file goes to the trash with it. You can restore it from Trash.',
        );
    });

    it('gives no count for a locked folder', () => {
        expect(toDeleteFolderMessage(byName('Surprise party'))).toBe(
            '"Surprise party" will be moved to Trash. Everything in it goes to the trash with it. You can restore it from Trash.',
        );
    });

    it('counts subfolders at every depth before making a folder private', () => {
        expect(toMakePrivateMessage(byName('Trips'))).toBe('"Trips", its 1 subfolder and 3 files will only show inside it, never in All documents or search.');
    });
});

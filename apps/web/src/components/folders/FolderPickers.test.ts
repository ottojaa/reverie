// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderPickerPanel } from '../organize/FolderPickerPanel';
import { UploadDestinationMenu } from '../upload/UploadDestinationMenu';
import { toTestFolder } from '../../testing/folders';
import { findByText, keyDown, mount, press } from '../../testing/render';

const requestUnlock = vi.fn(() => Promise.resolve(true));
const tree = [
    toTestFolder('Diary', { is_private: true, lock_id: 'Diary', locked: true }),
    toTestFolder('Taxes', { is_private: true, lock_id: 'Taxes' }),
    toTestFolder('Receipts'),
];

vi.mock('@/lib/sections', () => ({ useSections: () => ({ data: tree }) }));
vi.mock('@/lib/vault', () => ({ useVault: () => ({ requestUnlock }) }));
vi.mock('motion/react', () => ({
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    motion: { div: ({ children }: { children?: unknown }) => createElement('div', null, children as never) },
}));

const onPick = vi.fn();
let view: ReturnType<typeof mount>;

beforeEach(() => vi.clearAllMocks());
afterEach(() => view.unmount());

/** The open picker's row for a folder: whatever kind of list it is. */
const row = (name: string) => [...document.querySelectorAll('button, [role="menuitem"], [role="option"]')].find((el) => el.textContent?.startsWith(name));
const marks = (name: string) => [...(row(name)?.querySelectorAll('[aria-label]') ?? [])].map((el) => el.getAttribute('aria-label'));

const openers = {
    'the upload destination': async () => {
        view = mount(createElement(UploadDestinationMenu, { folderId: null, onPick }));
        await press(findByText('button', 'No folder (top level)'));
    },
    "Manual organize's parent folder": async () => {
        view = mount(createElement(FolderPickerPanel, { sections: tree, selected: undefined, onSelect: () => {}, onConfirm: onPick, isPending: false }));
        await press(findByText('button', 'New folder'));
        await press(document.getElementById('organize-folder-parent'));
    },
};

describe.each(Object.entries(openers))('%s picker', (_label, open) => {
    it('marks closed and open locks alike', async () => {
        await open();

        expect(marks('Diary')).toEqual(['Locked']);
        expect(marks('Taxes')).toEqual(['Private (unlocked)']);
        expect(marks('Receipts')).toEqual([]);
    });

    it('asks for the password before a locked folder is picked, and closes on the pick', async () => {
        await open();
        await press(row('Diary'));

        expect(requestUnlock).toHaveBeenCalledWith('Diary');
        expect(row('Receipts')).toBeUndefined();
    });

    it('is walked with the arrow keys', async () => {
        await open();
        (row('Diary') as HTMLElement).focus();
        await keyDown(document.activeElement, 'ArrowDown');

        expect(document.activeElement).toBe(row('Taxes'));
    });
});

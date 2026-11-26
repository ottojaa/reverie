// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { mount, settle } from '../../testing/render';
import { FolderContextMenu } from './FolderRowMenu';

const actions = { onNewFolder: vi.fn(), onEdit: vi.fn(), onTogglePrivate: vi.fn(), onDelete: vi.fn() };

/** The row menu's entries for a folder, as a right click shows them. */
async function openMenu(folder: ReturnType<typeof toTestFolder>) {
    const view = mount(createElement(FolderContextMenu, { folder, actions, children: createElement('div', { id: 'row' }, folder.name) }));

    document.getElementById('row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await settle(10);
    const entries = [...document.querySelectorAll('[role="menuitem"]')].map((item) => ({
        label: item.textContent,
        isDisabled: item.hasAttribute('data-disabled'),
    }));
    view.unmount();

    return entries;
}

describe('the row menu of a private folder', () => {
    it('does not offer to make public a folder that a private folder above keeps private', async () => {
        const entries = await openMenu(toTestFolder('statements', { is_private: true, lock_id: 'taxes' }));

        expect(entries).toContainEqual({ label: 'Private (inherited)', isDisabled: true });
        expect(entries.map((entry) => entry.label)).not.toContain('Remove from private');
    });

    it('offers it on the outermost private folder, whose flag is the one that counts', async () => {
        const entries = await openMenu(toTestFolder('taxes', { is_private: true, lock_id: 'taxes' }));

        expect(entries).toContainEqual({ label: 'Remove from private', isDisabled: false });
    });
});

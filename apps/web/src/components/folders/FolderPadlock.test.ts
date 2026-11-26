// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { mount, press } from '../../testing/render';
import { FolderPadlock } from './FolderPadlock';

const open = toTestFolder('taxes', { is_private: true, lock_id: 'taxes' });
const closed = { ...open, locked: true };

let view: ReturnType<typeof mount>;

afterEach(() => view.unmount());

const labels = () => [...document.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'));

describe('FolderPadlock', () => {
    it('shows nothing for a public folder', () => {
        view = mount(createElement(FolderPadlock, { folder: toTestFolder('photos') }));

        expect(document.body.textContent + labels().join()).toBe('');
    });

    it.each([
        ['an open', open, 'Private (unlocked)'],
        ['a closed', closed, 'Locked'],
    ])('marks %s lock', (_label, folder, name) => {
        view = mount(createElement(FolderPadlock, { folder }));

        expect(labels()).toEqual([name]);
        expect(document.querySelector('button')).toBeNull();
    });

    it('unlocks on a click when told how, without the click reaching the row', async () => {
        const onUnlock = vi.fn();
        const onRowClick = vi.fn();

        view = mount(createElement('div', { onClick: onRowClick }, createElement(FolderPadlock, { folder: closed, onUnlock })));
        await press(document.querySelector('button[aria-label="Locked, click to unlock"]'));

        expect(onUnlock).toHaveBeenCalledOnce();
        expect(onRowClick).not.toHaveBeenCalled();
    });
});

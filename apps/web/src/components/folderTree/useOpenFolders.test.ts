// @vitest-environment jsdom
import type { FolderWithChildren } from '@reverie/shared';
import { act, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { mount } from '../../testing/render';
import { useOpenFolders } from './useOpenFolders';

const norway = toTestFolder('norway', { parent_id: 'trips' });
const trips = toTestFolder('trips', { parent_id: 'photos', children: [norway] });
const photos = toTestFolder('photos', { children: [trips] });
const receipts = toTestFolder('receipts');

function render(tree: FolderWithChildren[], currentId?: string) {
    const result = {} as ReturnType<typeof useOpenFolders>;

    function Probe(props: { tree: FolderWithChildren[] }) {
        Object.assign(result, useOpenFolders(props.tree, currentId));

        return null;
    }

    const view = mount(createElement(Probe, { tree }));

    return { result, load: (next: FolderWithChildren[]) => view.render(createElement(Probe, { tree: next })), unmount: view.unmount };
}

describe('useOpenFolders', () => {
    it('starts with the top-level folders open and the deeper ones closed, even when the tree arrives late', () => {
        const view = render([]);

        view.load([photos, receipts]);

        expect(view.result.isOpen(photos)).toBe(true);
        expect(view.result.isOpen(trips)).toBe(false);
        view.unmount();
    });

    it('keeps a folder the way it was left, across a refetch', () => {
        const view = render([photos]);

        act(() => view.result.toggle(photos));
        act(() => view.result.toggle(trips));
        view.load([{ ...photos }]);

        expect(view.result.isOpen(photos)).toBe(false);
        expect(view.result.isOpen(trips)).toBe(true);
        view.unmount();
    });

    it('opens the way to the current folder, and a folder asked for', () => {
        const view = render([photos], 'norway');

        expect(view.result.isOpen(trips)).toBe(true);
        expect(view.result.isOpen(norway)).toBe(false);

        act(() => view.result.open(['norway']));

        expect(view.result.isOpen(norway)).toBe(true);
        view.unmount();
    });
});

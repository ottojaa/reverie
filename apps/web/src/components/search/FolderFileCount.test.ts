// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { mount } from '../../testing/render';
import { FolderFileCount } from './FolderFileCount';

// A cached tree that has not caught up yet: the hit's own count is the one to show.
vi.mock('@/lib/sections', () => ({ useCurrentSection: () => toTestFolder('papers', { kind_counts: { image: 1, video: 0, file: 1 } }) }));

describe('FolderFileCount', () => {
    it.each([
        [5, '5 files'],
        [1, '1 file'],
        [0, '0 files'],
    ])('says what the search counted: %i', (count, text) => {
        const view = mount(createElement(FolderFileCount, { result: { id: 'papers', document_count: count } as never }));

        expect(document.body.textContent).toBe(text);
        view.unmount();
    });
});

// @vitest-environment jsdom
import type { SearchResult } from '@reverie/shared';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, press } from '../../testing/render';
import { SearchResultItem } from './SearchResultItem';

const result = {
    document_id: 'doc-1',
    display_name: 'Meeting notes',
    filename: 'meeting-notes.txt',
    mime_type: 'text/plain',
    format: 'txt',
    category: null,
    tags: [],
    taught_tags: [],
    folder_id: null,
    folder_path: null,
    size_bytes: 10,
    uploaded_at: '2026-01-01T00:00:00Z',
    extracted_date: null,
    snippet: null,
    thumbnail_urls: null,
} as unknown as SearchResult;

let view: ReturnType<typeof mount>;

afterEach(() => {
    view.unmount();
    vi.restoreAllMocks();
});

describe.each([
    ['full', false],
    ['compact', true],
])('a %s search result row', (_name, compact) => {
    it('is one checkbox control when selectable, toggled once per click wherever it lands', async () => {
        const error = vi.spyOn(console, 'error');
        const onToggle = vi.fn();
        const element = (selected: boolean) => createElement(SearchResultItem, { result, compact, selected, onToggle });
        view = mount(element(false));

        expect(document.querySelectorAll('button')).toHaveLength(1);
        const row = document.querySelector('button')!;
        expect(row.getAttribute('role')).toBe('checkbox');
        expect(row.getAttribute('aria-checked')).toBe('false');

        await press(row);
        await press(row.querySelector('[data-slot="checkbox"]'));
        expect(onToggle.mock.calls).toEqual([['doc-1'], ['doc-1']]);

        view.render(element(true));
        expect(row.getAttribute('aria-checked')).toBe('true');
        expect(row.querySelector('[data-slot="checkbox"]')?.getAttribute('data-state')).toBe('checked');
        expect(error).not.toHaveBeenCalled();
    });

    it('is a plain button that opens the result when not selectable', async () => {
        const onClick = vi.fn();
        view = mount(createElement(SearchResultItem, { result, compact, onClick }));
        const row = document.querySelector('button')!;

        expect(row.getAttribute('role')).toBeNull();
        expect(row.getAttribute('aria-checked')).toBeNull();
        await press(row);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

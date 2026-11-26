// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { findByText, mount, press, settle, typeInto } from '../../testing/render';
import { SearchCommandPalette } from './SearchCommandPalette';

const navigate = vi.fn();

// Two folders named alike: the one picked must be the one searched.
const bills = toTestFolder('bills-id', { name: 'Bills', path: '/Papers/Bills', parent_id: 'papers-id' });
const tree = [toTestFolder('papers-id', { name: 'Papers', path: '/Papers', children: [bills] }), toTestFolder('other-id', { name: 'Bills', path: '/Bills' })];

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/sections', () => ({ useSections: () => ({ data: tree }), useCurrentSection: () => null }));
vi.mock('@/lib/api/search', () => ({
    useSearch: () => ({ data: undefined, isLoading: false }),
    useQuickFilters: () => ({ data: [] }),
    useSearchSuggestions: (type: string) => ({ data: type === 'folder' ? ['/Papers/Bills'] : ['bill.pdf'], isLoading: false }),
}));

let view: ReturnType<typeof mount>;

beforeEach(() => {
    localStorage.clear();
    navigate.mockClear();
    view = mount(createElement(SearchCommandPalette, { open: true, onOpenChange: () => {}, initialQuery: 'bil' }));
});

afterEach(() => view.unmount());

const input = () => document.body.querySelector<HTMLInputElement>('input')!;

describe('SearchCommandPalette folder suggestions', () => {
    it('scopes the search to the picked folder by id, with nothing typed left over', async () => {
        // Past the input's debounce, which brings up the suggestion tabs.
        await settle(300);
        await press(findByText('button', 'Folders'));
        await press(findByText('[cmdk-item]', '/Papers/Bills'));

        expect(navigate).toHaveBeenCalledWith({ to: '/search', search: expect.objectContaining({ q: '', folder_id: 'bills-id' }) });
        expect(input().value).toBe('');
    });

    it('does not teach the folder: token, which matches every folder of that name', async () => {
        await typeInto(input(), '');
        await settle(300);

        expect(document.body.textContent).toContain('Search your documents');
        expect(document.body.textContent).not.toContain('folder:');
    });
});

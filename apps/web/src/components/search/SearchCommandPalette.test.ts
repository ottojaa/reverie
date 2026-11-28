// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { findByText, mount, press, settle, typeInto } from '../../testing/render';
import { SearchCommandPalette } from './SearchCommandPalette';

const navigate = vi.fn();
const fetchReadQuery = vi.fn<(q: string) => Promise<string>>();

// Two folders named alike: the one picked must be the one searched.
const bills = toTestFolder('bills-id', { name: 'Bills', path: '/Papers/Bills', parent_id: 'papers-id' });
const tree = [toTestFolder('papers-id', { name: 'Papers', path: '/Papers', children: [bills] }), toTestFolder('other-id', { name: 'Bills', path: '/Bills' })];

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/sections', () => ({ useSections: () => ({ data: tree }), useCurrentSection: () => null }));
vi.mock('@/lib/api/search', () => ({
    fetchReadQuery: (q: string) => fetchReadQuery(q),
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

describe('SearchCommandPalette submit', () => {
    const searchAll = () => findByText('[cmdk-item]', 'Search for');

    it('searches with the query the reader answers', async () => {
        fetchReadQuery.mockResolvedValue('bil type:receipt');
        await settle(300);
        await press(searchAll());

        expect(fetchReadQuery).toHaveBeenCalledWith('bil');
        expect(navigate).toHaveBeenCalledWith({ to: '/search', search: expect.objectContaining({ q: 'bil type:receipt' }) });
    });

    it('drops an answer that arrives after more typing', async () => {
        let answer: (q: string) => void = () => {};

        fetchReadQuery.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        await settle(300);
        await press(searchAll());
        await typeInto(input(), 'bills');
        answer('bil type:receipt');
        await settle();

        expect(navigate).not.toHaveBeenCalled();
    });

    it('reads a recent search again', async () => {
        fetchReadQuery.mockResolvedValue('kuitit type:receipt');
        localStorage.setItem('reverie_recent_searches', JSON.stringify([{ query: 'kuitit', timestamp: '2026-11-01T00:00:00.000Z' }]));
        view.unmount();
        view = mount(createElement(SearchCommandPalette, { open: true, onOpenChange: () => {} }));
        await settle();
        await press(findByText('[cmdk-item]', 'kuitit'));

        expect(navigate).toHaveBeenCalledWith({ to: '/search', search: expect.objectContaining({ q: 'kuitit type:receipt' }) });
    });
});

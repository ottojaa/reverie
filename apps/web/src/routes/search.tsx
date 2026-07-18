import { createFileRoute } from '@tanstack/react-router';
import { SearchPage } from '../pages/Search';

const SORT_BY_VALUES = ['relevance', 'uploaded', 'date', 'filename', 'size'] as const;

export type SearchSortBy = (typeof SORT_BY_VALUES)[number];
export type SearchSortOrder = 'asc' | 'desc';
export type SearchResultView = 'list' | 'grid';

function toSortBy(value: unknown): SearchSortBy {
    return SORT_BY_VALUES.includes(value as SearchSortBy) ? (value as SearchSortBy) : 'relevance';
}

export const Route = createFileRoute('/search')({
    validateSearch: (search?: { q?: string; sort_by?: string; sort_order?: string; view?: string } | undefined) => ({
        q: typeof search?.q === 'string' ? search.q : '',
        sort_by: toSortBy(search?.sort_by),
        sort_order: search?.sort_order === 'asc' ? ('asc' as const) : ('desc' as const),
        // Absent = automatic (grid when a photo-ish filter is active, list otherwise)
        view: search?.view === 'grid' || search?.view === 'list' ? (search.view as SearchResultView) : undefined,
    }),
    component: SearchPage,
});

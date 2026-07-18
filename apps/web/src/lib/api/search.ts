import {
    FacetsResponseSchema,
    QuickFiltersResponseSchema,
    SearchHelpSchema,
    SearchResponseSchema,
    SuggestResponseSchema,
    type QuickFilter,
    type SearchFacets,
    type SearchHelp,
    type SearchResponse,
    type SuggestionType,
} from '@reverie/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { apiClient } from './client';

export interface SearchParams {
    q: string;
    sort_by?: 'relevance' | 'uploaded' | 'date' | 'filename' | 'size';
    sort_order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    include_facets?: boolean;
}

export const searchApi = {
    async search(params: SearchParams): Promise<SearchResponse> {
        const { data } = await apiClient.get('/search', { params });

        return SearchResponseSchema.parse(data);
    },

    async getFacets(): Promise<SearchFacets> {
        const { data } = await apiClient.get('/search/facets', { params: { q: '' } });

        return FacetsResponseSchema.parse(data).facets;
    },

    async suggest(type: SuggestionType, q: string, limit = 10): Promise<string[]> {
        const { data } = await apiClient.get('/search/suggest', {
            params: { type, q, limit },
        });

        return SuggestResponseSchema.parse(data);
    },

    async getQuickFilters(): Promise<QuickFilter[]> {
        const { data } = await apiClient.get('/search/quick-filters');

        return QuickFiltersResponseSchema.parse(data);
    },

    async getHelp(): Promise<SearchHelp> {
        const { data } = await apiClient.get('/search/help');

        return SearchHelpSchema.parse(data);
    },
};

const DEFAULT_PAGE_SIZE = 24;

export function useSearch(params: SearchParams, enabled = true) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['search', params],
        queryFn: () => searchApi.search(params),
        enabled: isAuthenticated && enabled,
        staleTime: 30_000,
    });
}

export function useInfiniteSearch(params: Omit<SearchParams, 'offset'>, enabled = true) {
    const { isAuthenticated } = useAuth();
    const limit = params.limit ?? DEFAULT_PAGE_SIZE;

    return useInfiniteQuery({
        queryKey: ['search', 'infinite', { ...params, limit }],
        queryFn: ({ pageParam }) => searchApi.search({ ...params, limit, offset: pageParam }),
        initialPageParam: 0,
        getNextPageParam: (lastPage, _allPages, lastPageParam) => {
            const nextOffset = (lastPageParam as number) + limit;

            return nextOffset < lastPage.total ? nextOffset : undefined;
        },
        enabled: isAuthenticated && enabled,
        staleTime: 30_000,
        // Keep previous results/facets visible while a pill click refetches — no flash to empty
        placeholderData: (prev) => prev,
    });
}

/** Full-corpus facet values for the filter panels — never narrowed by the active query. */
export function useSearchFacets() {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['search', 'facets'],
        queryFn: () => searchApi.getFacets(),
        enabled: isAuthenticated,
        staleTime: 5 * 60_000,
    });
}

export function useSearchSuggestions(type: SuggestionType, q: string, limit = 8) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['search', 'suggestions', type, q, limit],
        queryFn: () => searchApi.suggest(type, q, limit),
        enabled: isAuthenticated && q.length >= 1,
        staleTime: 60_000,
    });
}

export function useQuickFilters() {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['search', 'quick-filters'],
        queryFn: () => searchApi.getQuickFilters(),
        enabled: isAuthenticated,
        staleTime: 5 * 60_000,
    });
}

export function useSearchHelp() {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['search', 'help'],
        queryFn: () => searchApi.getHelp(),
        enabled: isAuthenticated,
        staleTime: 10 * 60_000,
    });
}

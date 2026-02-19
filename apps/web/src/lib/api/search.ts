import type { SearchResponse, SuggestionType } from '@reverie/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuth, useAuthenticatedFetch } from '../auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

export interface SearchParams {
    q: string;
    category?: string;
    date_from?: string;
    date_to?: string;
    folder_id?: string;
    sort_by?: 'relevance' | 'uploaded' | 'date' | 'filename' | 'size';
    sort_order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    include_facets?: boolean;
}

export interface QuickFilter {
    label: string;
    query: string;
    icon?: string;
}

export interface SearchHelpFilter {
    name: string;
    syntax: string;
    examples: string[];
    description: string;
}

export interface SearchHelp {
    filters: SearchHelpFilter[];
    examples: Array<{ query: string; description: string }>;
}

async function fetchSearch(authFetch: AuthFetch, params: SearchParams): Promise<SearchResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('q', params.q);

    if (params.category) searchParams.set('category', params.category);

    if (params.date_from) searchParams.set('date_from', params.date_from);

    if (params.date_to) searchParams.set('date_to', params.date_to);

    if (params.folder_id) searchParams.set('folder_id', params.folder_id);

    if (params.sort_by) searchParams.set('sort_by', params.sort_by);

    if (params.sort_order) searchParams.set('sort_order', params.sort_order);

    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));

    if (params.offset !== undefined) searchParams.set('offset', String(params.offset));

    if (params.include_facets !== undefined) searchParams.set('include_facets', String(params.include_facets));

    const response = await authFetch(`${API_BASE}/search?${searchParams}`, { credentials: 'include' });

    if (!response.ok) throw new Error('Search failed');

    return response.json();
}

async function fetchSuggestions(
    authFetch: AuthFetch,
    type: SuggestionType,
    q: string,
    limit = 10,
): Promise<string[]> {
    const params = new URLSearchParams({ type, q, limit: String(limit) });
    const response = await authFetch(`${API_BASE}/search/suggest?${params}`, { credentials: 'include' });

    if (!response.ok) throw new Error('Suggestions failed');

    return response.json();
}

async function fetchQuickFilters(authFetch: AuthFetch): Promise<QuickFilter[]> {
    const response = await authFetch(`${API_BASE}/search/quick-filters`, { credentials: 'include' });

    if (!response.ok) throw new Error('Quick filters failed');

    return response.json();
}

async function fetchSearchHelp(authFetch: AuthFetch): Promise<SearchHelp> {
    const response = await authFetch(`${API_BASE}/search/help`, { credentials: 'include' });

    if (!response.ok) throw new Error('Search help failed');

    return response.json();
}

const DEFAULT_PAGE_SIZE = 24;

export function useSearch(params: SearchParams, enabled = true) {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    return useQuery({
        queryKey: ['search', params],
        queryFn: () => fetchSearch(authFetch, params),
        enabled: isAuthenticated && enabled,
        staleTime: 30_000,
    });
}

export function useInfiniteSearch(params: Omit<SearchParams, 'offset'>) {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();
    const limit = params.limit ?? DEFAULT_PAGE_SIZE;

    return useInfiniteQuery({
        queryKey: ['search', 'infinite', { ...params, limit }],
        queryFn: ({ pageParam }) =>
            fetchSearch(authFetch, { ...params, limit, offset: pageParam as number }),
        initialPageParam: 0,
        getNextPageParam: (lastPage, _allPages, lastPageParam) => {
            const nextOffset = (lastPageParam as number) + limit;

            return nextOffset < lastPage.total ? nextOffset : undefined;
        },
        enabled: isAuthenticated && params.q.length > 0,
        staleTime: 30_000,
    });
}

export function useSearchSuggestions(type: SuggestionType, q: string, limit = 8) {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    return useQuery({
        queryKey: ['search', 'suggestions', type, q, limit],
        queryFn: () => fetchSuggestions(authFetch, type, q, limit),
        enabled: isAuthenticated && q.length >= 1,
        staleTime: 60_000,
    });
}

export function useQuickFilters() {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    return useQuery({
        queryKey: ['search', 'quick-filters'],
        queryFn: () => fetchQuickFilters(authFetch),
        enabled: isAuthenticated,
        staleTime: 5 * 60_000,
    });
}

export function useSearchHelp() {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    return useQuery({
        queryKey: ['search', 'help'],
        queryFn: () => fetchSearchHelp(authFetch),
        enabled: isAuthenticated,
        staleTime: 10 * 60_000,
    });
}

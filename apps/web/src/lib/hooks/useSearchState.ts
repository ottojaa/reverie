import type { RecentSearch } from '@reverie/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

const RECENT_SEARCHES_KEY = 'reverie_recent_searches';
const MAX_RECENT_SEARCHES = 20;

export interface SearchState {
    query: string;
    debouncedQuery: string;
    setQuery: (q: string) => void;
    clearQuery: () => void;
    recentSearches: RecentSearch[];
    addRecentSearch: (query: string, resultCount: number) => void;
    removeRecentSearch: (query: string) => void;
    clearRecentSearches: () => void;
}

function loadRecentSearches(): RecentSearch[] {
    try {
        const raw = localStorage.getItem(RECENT_SEARCHES_KEY);

        if (!raw) return [];

        return JSON.parse(raw) as RecentSearch[];
    } catch {
        return [];
    }
}

function saveRecentSearches(searches: RecentSearch[]) {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
}

export function useSearchState(debounceMs = 300): SearchState {
    const [query, setQueryRaw] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(loadRecentSearches);
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const setQuery = useCallback(
        (q: string) => {
            setQueryRaw(q);
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setDebouncedQuery(q), debounceMs);
        },
        [debounceMs],
    );

    const clearQuery = useCallback(() => {
        setQueryRaw('');
        setDebouncedQuery('');
        clearTimeout(timerRef.current);
    }, []);

    useEffect(() => {
        return () => clearTimeout(timerRef.current);
    }, []);

    const addRecentSearch = useCallback((q: string, resultCount: number) => {
        if (!q.trim()) return;

        setRecentSearches((prev) => {
            const filtered = prev.filter((s) => s.query !== q);
            const next: RecentSearch[] = [
                { query: q, timestamp: new Date().toISOString(), resultCount },
                ...filtered,
            ].slice(0, MAX_RECENT_SEARCHES);
            saveRecentSearches(next);

            return next;
        });
    }, []);

    const removeRecentSearch = useCallback((q: string) => {
        setRecentSearches((prev) => {
            const next = prev.filter((s) => s.query !== q);
            saveRecentSearches(next);

            return next;
        });
    }, []);

    const clearRecentSearches = useCallback(() => {
        setRecentSearches([]);
        localStorage.removeItem(RECENT_SEARCHES_KEY);
    }, []);

    return {
        query,
        debouncedQuery,
        setQuery,
        clearQuery,
        recentSearches,
        addRecentSearch,
        removeRecentSearch,
        clearRecentSearches,
    };
}

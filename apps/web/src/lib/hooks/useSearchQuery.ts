import type { SearchResultView, SearchSortBy, SearchSortOrder } from '@/routes/search';
import {
    addFilter,
    getFilterTokens,
    getFreeText,
    isKnownFilter,
    removeFilter,
    replaceFilter,
    serializeQuery,
    setFreeText,
    tokenizeQuery,
    type FilterKey,
    type QueryToken,
} from '@reverie/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useRef } from 'react';

export interface SearchQueryState {
    q: string;
    tokens: QueryToken[];
    freeText: string;
    /** Positive (non-negated) filter values per known key. */
    filterValues: Map<FilterKey, string[]>;
    /** Count of distinct filter dimensions with at least one token (negated included). */
    activeDimensionCount: number;
    sortBy: SearchSortBy;
    sortOrder: SearchSortOrder;
    view: SearchResultView | undefined;
    commitFreeText: (text: string) => void;
    toggleFilterValue: (key: FilterKey, value: string, opts?: { negated?: boolean }) => void;
    setFilterValue: (key: FilterKey, value: string, opts?: { negated?: boolean }) => void;
    /** Tri-state for a single key+value pair: include (`has:text`), exclude (`-has:text`), or absent. */
    setFilterValueState: (key: FilterKey, value: string, state: 'any' | 'include' | 'exclude') => void;
    removeDimension: (key: FilterKey) => void;
    removeToken: (token: QueryToken) => void;
    clearAllFilters: () => void;
    setQuery: (q: string) => void;
    setSort: (sortBy: SearchSortBy) => void;
    setView: (view: SearchResultView) => void;
}

/**
 * Single state broker for the /search page. All filter state lives in the `q`
 * URL param as DSL tokens; every mutation goes tokens → serialize → navigate.
 * Mutators read the latest q from a ref so debounced/async callers never
 * operate on a stale query string.
 */
export function useSearchQuery(): SearchQueryState {
    const { q, sort_by, sort_order, view } = useSearch({ from: '/search' });
    const navigate = useNavigate();

    const qRef = useRef(q);
    qRef.current = q;

    const tokens = useMemo(() => tokenizeQuery(q), [q]);
    const freeText = useMemo(() => getFreeText(tokens), [tokens]);

    const filterValues = useMemo(() => {
        const map = new Map<FilterKey, string[]>();

        for (const token of getFilterTokens(tokens)) {
            if (token.negated || !token.key) continue;

            const key = token.key as FilterKey;
            map.set(key, [...(map.get(key) ?? []), token.value]);
        }

        return map;
    }, [tokens]);

    const activeDimensionCount = useMemo(() => {
        const keys = new Set(getFilterTokens(tokens).map((token) => token.key));

        return keys.size;
    }, [tokens]);

    const navigateWith = useCallback(
        (updates: { q?: string; sort_by?: SearchSortBy; sort_order?: SearchSortOrder; view?: SearchResultView }) => {
            navigate({
                to: '/search',
                search: {
                    q: updates.q ?? qRef.current,
                    sort_by: updates.sort_by ?? sort_by,
                    sort_order: updates.sort_order ?? sort_order,
                    view: 'view' in updates ? updates.view : view,
                },
                replace: true,
            });
        },
        [navigate, sort_by, sort_order, view],
    );

    const setQuery = useCallback((next: string) => navigateWith({ q: next }), [navigateWith]);

    const commitFreeText = useCallback((text: string) => setQuery(setFreeText(qRef.current, text)), [setQuery]);

    const toggleFilterValue = useCallback(
        (key: FilterKey, value: string, opts?: { negated?: boolean }) => {
            const current = qRef.current;
            const exists = getFilterTokens(tokenizeQuery(current), key).some(
                (token) => token.value.toLowerCase() === value.toLowerCase() && token.negated === (opts?.negated ?? false),
            );

            setQuery(exists ? removeFilter(current, key, value) : addFilter(current, key, value, opts));
        },
        [setQuery],
    );

    const setFilterValue = useCallback(
        (key: FilterKey, value: string, opts?: { negated?: boolean }) => setQuery(replaceFilter(qRef.current, key, value, opts)),
        [setQuery],
    );

    const setFilterValueState = useCallback(
        (key: FilterKey, value: string, state: 'any' | 'include' | 'exclude') => {
            const without = removeFilter(qRef.current, key, value);

            if (state === 'any') {
                setQuery(without);

                return;
            }

            setQuery(addFilter(without, key, value, { negated: state === 'exclude' }));
        },
        [setQuery],
    );

    const removeDimension = useCallback((key: FilterKey) => setQuery(removeFilter(qRef.current, key)), [setQuery]);

    const removeToken = useCallback(
        (token: QueryToken) => {
            const remaining = tokenizeQuery(qRef.current).filter((t) => t.raw !== token.raw || t.key !== token.key || t.value !== token.value);

            setQuery(serializeQuery(remaining));
        },
        [setQuery],
    );

    const clearAllFilters = useCallback(() => {
        const remaining = tokenizeQuery(qRef.current).filter((token) => !isKnownFilter(token));

        setQuery(serializeQuery(remaining));
    }, [setQuery]);

    const setSort = useCallback(
        (nextSortBy: SearchSortBy) => {
            if (nextSortBy === sort_by) {
                navigateWith({ sort_order: sort_order === 'asc' ? 'desc' : 'asc' });

                return;
            }

            navigateWith({ sort_by: nextSortBy, sort_order: 'desc' });
        },
        [navigateWith, sort_by, sort_order],
    );

    const setView = useCallback((nextView: SearchResultView) => navigateWith({ view: nextView }), [navigateWith]);

    return {
        q,
        tokens,
        freeText,
        filterValues,
        activeDimensionCount,
        sortBy: sort_by,
        sortOrder: sort_order,
        view,
        commitFreeText,
        toggleFilterValue,
        setFilterValue,
        setFilterValueState,
        removeDimension,
        removeToken,
        clearAllFilters,
        setQuery,
        setSort,
        setView,
    };
}

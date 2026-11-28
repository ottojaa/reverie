import { getApiErrorMessage } from '@/lib/api/client';
import { SEARCH_HARDER_MARK_KEY, searchApi } from '@/lib/api/search';
import { useScrollContainer } from '@/lib/ScrollContainerContext';
import type { SearchSortBy, SearchSortOrder } from '@/routes/search';
import type { SearchHit } from '@reverie/shared';
import { notifyManager, useMutation, useMutationState, useQueryClient, type MutationState } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

const MUTATION_KEY = ['search-harder'];

/** What the search page shows. A run belongs to exactly one of these. */
export interface SearchHarderTarget {
    q: string;
    folderId: string | undefined;
    sortBy: SearchSortBy;
    sortOrder: SearchSortOrder;
}

interface RunVariables {
    key: string;
    q: string;
    folderId: string | undefined;
}

export interface SearchHarderState {
    isRunning: boolean;
    /** Set once the run for this search has answered; empty when it found nothing. */
    results: SearchHit[] | undefined;
    errorMessage: string | undefined;
    /** The server has no language model, so asking again is pointless. */
    isUnavailable: boolean;
    run: () => void;
}

/** A run is started from under the results: bring its answer, which replaces them, into view. */
function useShowAnswer(status: MutationState['status'] | undefined) {
    const scrollContainerRef = useScrollContainer();
    const previousRef = useRef(status);

    useEffect(() => {
        if (previousRef.current === 'pending' && status === 'success') scrollContainerRef.current?.scrollTo({ top: 0 });

        previousRef.current = status;
    }, [status, scrollContainerRef]);
}

/** Whether the library has changed under the latest run: a move, a delete, a folder made private. */
function useIsOutdated(): boolean {
    const queryClient = useQueryClient();
    const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(notifyManager.batchCalls(onChange)), [queryClient]);

    return useSyncExternalStore(subscribe, () => queryClient.getQueryState(SEARCH_HARDER_MARK_KEY)?.isInvalidated ?? false);
}

/**
 * The "search harder" run of the search on screen. Each run costs money, so it only starts from `run` and is never
 * refetched. The answer is kept in memory while the search stays the same (opening a result and coming back keeps
 * it) and is dropped as soon as the search or the library changes, a late answer included.
 */
export function useSearchHarder({ q, folderId, sortBy, sortOrder }: SearchHarderTarget): SearchHarderState {
    const queryClient = useQueryClient();
    const key = JSON.stringify([q, folderId, sortBy, sortOrder]);

    const { mutate } = useMutation({
        mutationKey: MUTATION_KEY,
        mutationFn: ({ q, folderId }: RunVariables) => searchApi.searchHarder({ q, ...(folderId && { folder_id: folderId }) }),
        gcTime: Infinity,
    });

    // Read from the cache, not from `useMutation`, so the run outlives the page
    const runs = useMutationState({
        filters: { mutationKey: MUTATION_KEY },
        select: (mutation) => mutation.state as MutationState<Awaited<ReturnType<typeof searchApi.searchHarder>>, Error, RunVariables>,
    });
    const latest = runs.at(-1);
    const isOutdated = useIsOutdated();
    const current = latest?.variables?.key === key && !isOutdated ? latest : undefined;
    const isStale = latest !== undefined && current === undefined;

    const discard = useCallback(() => {
        const cache = queryClient.getMutationCache();

        for (const mutation of cache.findAll({ mutationKey: MUTATION_KEY })) cache.remove(mutation);
    }, [queryClient]);

    useEffect(() => {
        if (isStale) discard();
    }, [isStale, discard]);

    const run = useCallback(() => {
        discard();
        queryClient.setQueryDefaults(SEARCH_HARDER_MARK_KEY, { gcTime: Infinity });
        queryClient.setQueryData(SEARCH_HARDER_MARK_KEY, true);
        mutate({ key, q, folderId });
    }, [discard, queryClient, mutate, key, q, folderId]);

    useShowAnswer(current?.status);

    const error = current?.error;

    return {
        isRunning: current?.status === 'pending',
        results: current?.data?.results,
        errorMessage: error ? getApiErrorMessage(error, 'Search harder failed. Try again.') : undefined,
        isUnavailable: isAxiosError(error) && error.response?.data?.error === 'LLM_UNAVAILABLE',
        run,
    };
}

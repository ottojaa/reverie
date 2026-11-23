import { useEffect } from 'react';

const ROWS_BEFORE_END = 2;

/**
 * Asks for the next page once the last rendered row is within two rows of the end of the list.
 * `lastRowIndex` is -1 while nothing is rendered.
 */
export function useFetchNearEnd({
    lastRowIndex,
    rowCount,
    hasNextPage,
    fetchNextPage,
}: {
    lastRowIndex: number;
    rowCount: number;
    hasNextPage: boolean | undefined;
    fetchNextPage: (() => void) | undefined;
}) {
    useEffect(() => {
        if (!hasNextPage || !fetchNextPage) return;

        if (lastRowIndex < 0) return;

        if (lastRowIndex >= rowCount - ROWS_BEFORE_END) fetchNextPage();
    }, [lastRowIndex, hasNextPage, fetchNextPage, rowCount]);
}

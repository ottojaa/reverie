import { useScrollContainer } from '@/lib/ScrollContainerContext';
import { useFetchNearEnd } from '@/lib/hooks/useFetchNearEnd';
import { useElementScrollRestoration, useRouter } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// One measured offset per table, module-scoped: a back-navigation remount starts from the previous offset, so the
// router's scroll restoration isn't clamped by a briefly too short list. Each table sits under a different page header
// (the Files view under a title, Recently added under the cards row), so they must not share one.
const cachedBodyOffsets = new Map<string, number>();

interface UseVirtualTableOptions {
    /** Names the table in the offset cache. */
    cacheKey: string;
    rowCount: number;
    rowKey: (index: number) => string | number;
    rowHeight: number;
    hasNextPage?: boolean | undefined;
    fetchNextPage?: (() => void) | undefined;
    /** Open at the scroll position the router remembered; false when the list is a different one than that was kept for. */
    restoreScroll?: boolean;
}

/**
 * The virtualized body of a table that scrolls with the page: measures where the body starts in the scrolling area,
 * restores the router's scroll position, and asks for the next page when the last rows come into view.
 */
export function useVirtualTable({ cacheKey, rowCount, rowKey, rowHeight, hasNextPage, fetchNextPage, restoreScroll = true }: UseVirtualTableOptions) {
    const scrollContainerRef = useScrollContainer();
    const bodyRef = useRef<HTMLDivElement>(null);
    const [scrollMargin, setScrollMargin] = useState(cachedBodyOffsets.get(cacheKey) ?? 0);
    const scrollEntry = useElementScrollRestoration({ id: 'main-scroll-area' });
    const router = useRouter();
    const restoredOffset = restoreScroll ? scrollEntry?.scrollY : undefined;

    // The router puts the remembered offset back and then scrolls the area to the top anyway (it counts only the window
    // as restored, and the area is listed in scrollToTopSelectors), so put it back once more after that pass.
    useEffect(() => {
        if (restoredOffset === undefined) return;

        const unsubscribe = router.subscribe('onRendered', () => {
            scrollContainerRef.current?.scrollTo({ top: restoredOffset });
            unsubscribe();
        });

        return unsubscribe;
        // Only the offset the page opened at: later renders must not pull the scroll back.
    }, []);

    // The body's distance from the top of the scrolling area: what sits above it (the page header, the cards) can change
    // height, so measure when the area or the page inside it resizes, not on every render (scrolling re-renders per row).
    useLayoutEffect(() => {
        const body = bodyRef.current;
        const container = scrollContainerRef.current;

        if (!body || !container) return;

        const measure = () => {
            const offset = Math.round(body.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop);
            cachedBodyOffsets.set(cacheKey, offset);
            setScrollMargin(offset);
        };

        measure();

        const observer = new ResizeObserver(measure);
        observer.observe(container);

        if (container.firstElementChild) observer.observe(container.firstElementChild);

        return () => observer.disconnect();
    }, [cacheKey, scrollContainerRef]);

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => rowHeight,
        getItemKey: rowKey,
        overscan: 6,
        scrollMargin,
        initialOffset: restoredOffset,
        paddingEnd: 60,
    });

    const virtualItems = virtualizer.getVirtualItems();

    useFetchNearEnd({
        lastRowIndex: virtualItems[virtualItems.length - 1]?.index ?? -1,
        rowCount,
        hasNextPage,
        fetchNextPage,
    });

    return { bodyRef, virtualizer, virtualItems, scrollMargin };
}

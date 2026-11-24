import type { BrowseLayout } from '@/lib/browse/browse-layout';
import { buildGridRows } from '@/lib/browse/document-months';
import { packJustifiedRows, TILE_GAP, tileColumns, tileSize } from '@/lib/browse/justified-rows';
import { useFetchNearEnd } from '@/lib/hooks/useFetchNearEnd';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useRestoredScroll } from '@/lib/hooks/useRestoredScroll';
import { useScrollContainer } from '@/lib/ScrollContainerContext';
import { useUpload } from '@/lib/upload';
import type { Document } from '@reverie/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentGridRow } from './DocumentGridRow';

const GAP = 16; // gap-4 = 1rem = 16px
const COL_DEBOUNCE_MS = 80;
const HYSTERESIS = 20; // px buffer at breakpoints to prevent bounce
const MONTH_HEADER_HEIGHT = 32;
const CONTENT_PADDING_X = 24; // Browse wraps the grid in p-6 (24px each side); cold-start width fallback only

// Module-scoped so they survive unmount: on a back-navigation remount they seed the exact
// previous layout, so getTotalSize() is correct on the first render and the router's scroll
// restoration isn't clamped by a briefly-too-short grid (wrong columnCount / row estimate).
let cachedGridWidth = 0;
let cachedGridOffsetTop = 0;

/** Match Tailwind responsive grid breakpoints: sm:2 / md:3 / lg:4 / xl:5 */
function getColumnCount(width: number, prevCols?: number): number {
    const raw = (() => {
        if (width >= 1280) return 5;

        if (width >= 1024) return 4;

        if (width >= 768) return 3;

        if (width >= 640) return 2;

        return 1;
    })();

    if (prevCols === undefined) return raw;

    // Hysteresis: resist switching down until we're clearly below breakpoint
    if (raw < prevCols) {
        const thresholds: Record<number, number> = { 5: 1280, 4: 1024, 3: 768, 2: 640 };
        const threshold = thresholds[prevCols];

        if (threshold != null && width >= threshold - HYSTERESIS) return prevCols;
    }

    return raw;
}

interface DocumentGridProps {
    documents: Document[];
    isLoading?: boolean;
    fetchNextPage?: () => void;
    hasNextPage?: boolean;
    /** Put a month header (label only) before each run of documents from one month. */
    groupByMonth?: boolean;
    /** Open at the scroll position the router remembered; false when the list is a different one than that was kept for. */
    restoreScroll?: boolean;
    /** Cards (with a footer), Grid (square tiles) or Justified (tiles that keep their aspect ratio). */
    layout?: BrowseLayout;
}

export function DocumentGrid({
    documents,
    isLoading,
    fetchNextPage,
    hasNextPage,
    groupByMonth = false,
    restoreScroll = true,
    layout = 'cards',
}: DocumentGridProps) {
    const scrollContainerRef = useScrollContainer();
    const gridRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const { recentlyCompletedDocumentIds, markPulseComplete } = useUpload();
    const [pulsingIds, setPulsingIds] = useState<Set<string>>(new Set());
    // Seed from the widest synchronous source available on a remount: the cached grid
    // width (exact, from a previous mount) or the persistent <main> minus its padding.
    const [gridWidth, setGridWidth] = useState(() => {
        if (typeof window === 'undefined') return 0;

        return Math.floor(cachedGridWidth || (scrollContainerRef.current ? scrollContainerRef.current.clientWidth - CONTENT_PADDING_X * 2 : window.innerWidth));
    });
    const [columnCount, setColumnCount] = useState(() => {
        if (typeof window === 'undefined') return 1;

        if (window.matchMedia('(pointer: coarse)').matches) return 1;

        return getColumnCount(gridWidth);
    });
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Memoize orderedIds once for all cards
    const orderedIds = useMemo(() => documents.map((d) => d.id), [documents]);

    // --- Pulse animation logic ---

    useEffect(() => {
        if (recentlyCompletedDocumentIds.length === 0) return;

        setPulsingIds((prev) => {
            const next = new Set(prev);

            for (const id of recentlyCompletedDocumentIds) {
                next.add(id);
            }

            return next;
        });

        for (const id of recentlyCompletedDocumentIds) {
            markPulseComplete(id);
        }
    }, [recentlyCompletedDocumentIds, markPulseComplete]);

    const handlePulseComplete = useCallback((id: string) => {
        setPulsingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);

            return next;
        });
    }, []);

    // --- Responsive column count ---

    useEffect(() => {
        const el = gridRef.current;

        if (!el) return;

        const latestWidthRef = { current: 0 };

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];

            if (!entry) return;

            cachedGridWidth = entry.contentRect.width; // keep warm for the next remount
            latestWidthRef.current = entry.contentRect.width;

            if (debounceRef.current) clearTimeout(debounceRef.current);

            debounceRef.current = setTimeout(() => {
                debounceRef.current = null;
                const width = latestWidthRef.current;

                setGridWidth(Math.floor(width));
                setColumnCount((prev) => (isMobile ? 1 : getColumnCount(width, prev)));
            }, COL_DEBOUNCE_MS);
        });

        // Set initial from observed element (not window)
        const rect = el.getBoundingClientRect();
        cachedGridWidth = rect.width;
        cachedGridOffsetTop = el.offsetTop;
        setGridWidth(Math.floor(rect.width));
        setColumnCount(isMobile ? 1 : getColumnCount(rect.width));
        observer.observe(el);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);

            observer.disconnect();
        };
    }, [isMobile]);

    // --- Virtualizer ---

    const currentYear = new Date().getFullYear();
    const isCards = layout === 'cards';
    const columns = layout === 'grid' ? tileColumns(gridWidth) : columnCount;
    const tileSide = tileSize(gridWidth, columns);
    const rowGap = isCards ? GAP : TILE_GAP;
    const pack = useMemo(() => (layout === 'justified' ? (docs: Document[]) => packJustifiedRows(docs, { width: gridWidth }) : undefined), [layout, gridWidth]);
    const rows = useMemo(() => buildGridRows(documents, { columns, groupByMonth, currentYear, pack }), [documents, columns, groupByMonth, currentYear, pack]);
    const rowCount = rows.length;

    // Widest synchronous width source, most precise first: the mounted grid, the cached width
    // from a previous mount, the persistent <main> minus padding, then the window.
    const resolveGridWidth = useCallback(() => {
        const grid = gridRef.current;

        if (grid?.clientWidth) return grid.clientWidth;

        if (cachedGridWidth) return cachedGridWidth;

        const main = scrollContainerRef.current;

        if (main?.clientWidth) return main.clientWidth - CONTENT_PADDING_X * 2;

        return typeof window !== 'undefined' ? window.innerWidth : 0;
    }, [scrollContainerRef]);

    const estimateCardRowHeight = useCallback(() => {
        const containerWidth = resolveGridWidth();

        if (!containerWidth) return 350;

        const colWidth = (containerWidth - (columnCount - 1) * GAP) / columnCount;

        // aspect-4/3 thumbnail + ~48px footer
        return colWidth * 0.75 + 80;
    }, [columnCount, resolveGridWidth]);

    const estimateRowHeight = useCallback(
        (index: number) => {
            const row = rows[index];

            if (row?.type === 'header') return MONTH_HEADER_HEIGHT;

            if (layout === 'grid') return tileSide;

            if (layout === 'justified' && row?.height) return row.height;

            return estimateCardRowHeight();
        },
        [rows, layout, tileSide, estimateCardRowHeight],
    );

    // <main>'s remembered scroll position, so the virtualizer renders the correct rows immediately (before the router
    // restores scrollTop).
    const restoredOffset = useRestoredScroll(restoreScroll);

    const scrollMargin = gridRef.current?.offsetTop ?? cachedGridOffsetTop;

    const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: estimateRowHeight,
        getItemKey,
        overscan: 1,
        scrollMargin,
        gap: rowGap,
        initialOffset: restoredOffset,
        paddingEnd: 60,
    });

    // virtual-core only re-lays-out rows when count, scrollMargin or getItemKey change; a resize that keeps the
    // row keys but changes tile or card sizes needs a nudge.
    useEffect(() => {
        virtualizer.measure();
    }, [virtualizer, gridWidth, columns, layout]);

    // --- Infinite scroll trigger ---

    const virtualItems = virtualizer.getVirtualItems();
    const lastVirtualItemIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

    useFetchNearEnd({ lastRowIndex: lastVirtualItemIndex, rowCount, hasNextPage, fetchNextPage });

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="aspect-4/3 animate-pulse rounded-xl bg-muted" />
                ))}
            </div>
        );
    }

    return (
        <div ref={gridRef}>
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualItems.map((virtualRow) => {
                    const row = rows[virtualRow.index];

                    if (!row) return null;

                    const style = { top: virtualRow.start - scrollMargin, height: virtualRow.size, gap: rowGap };

                    if (row.type === 'header') {
                        return (
                            <h2 key={virtualRow.key} className="absolute left-0 right-0 flex items-end text-lg font-semibold tracking-tight" style={style}>
                                {row.label}
                            </h2>
                        );
                    }

                    return (
                        <DocumentGridRow
                            key={virtualRow.key}
                            row={row}
                            layout={layout}
                            columns={columns}
                            tileSide={tileSide}
                            orderedIds={orderedIds}
                            pulsingIds={pulsingIds}
                            onPulseComplete={handlePulseComplete}
                            style={style}
                        />
                    );
                })}
            </div>
        </div>
    );
}

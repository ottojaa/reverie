import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useScrollContainer } from '@/lib/ScrollContainerContext';
import { useUpload } from '@/lib/upload';
import type { Document } from '@reverie/shared';
import { useElementScrollRestoration } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentCard } from './DocumentCard';

const GAP = 16; // gap-4 = 1rem = 16px
const COL_DEBOUNCE_MS = 80;
const HYSTERESIS = 20; // px buffer at breakpoints to prevent bounce

/** Match Tailwind responsive grid breakpoints: sm:2 / md:3 / lg:4 / xl:5 */
function getColumnCount(width: number, prevCols?: number): number {
    const raw = (() => {
        if (width >= 1280) return 4;

        if (width >= 1024) return 3;

        if (width >= 768) return 2;

        return 1;
    })();

    if (prevCols === undefined) return raw;

    // Hysteresis: resist switching down until we're clearly below breakpoint
    if (raw < prevCols) {
        const thresholds: Record<number, number> = { 5: 1280, 4: 1024, 3: 768 };
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
}

export function DocumentGrid({ documents, isLoading, fetchNextPage, hasNextPage }: DocumentGridProps) {
    const scrollContainerRef = useScrollContainer();
    const gridRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const { recentlyCompletedDocumentIds, markPulseComplete } = useUpload();
    const [pulsingIds, setPulsingIds] = useState<Set<string>>(new Set());
    const [columnCount, setColumnCount] = useState(() => {
        if (typeof window === 'undefined') return 1;

        return window.matchMedia('(pointer: coarse)').matches ? 1 : getColumnCount(window.innerWidth);
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

            latestWidthRef.current = entry.contentRect.width;

            if (debounceRef.current) clearTimeout(debounceRef.current);

            debounceRef.current = setTimeout(() => {
                debounceRef.current = null;
                const width = latestWidthRef.current;

                setColumnCount((prev) => (isMobile ? 1 : getColumnCount(width, prev)));
            }, COL_DEBOUNCE_MS);
        });

        // Set initial from observed element (not window)
        const width = el.getBoundingClientRect().width;
        setColumnCount(isMobile ? 1 : getColumnCount(width));
        observer.observe(el);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);

            observer.disconnect();
        };
    }, [isMobile]);

    // --- Virtualizer ---

    const rowCount = Math.ceil(documents.length / columnCount);

    const estimateRowHeight = useCallback(() => {
        const el = gridRef.current;

        if (!el) return 350;

        const containerWidth = el.clientWidth;
        const colWidth = (containerWidth - (columnCount - 1) * GAP) / columnCount;

        // aspect-4/3 thumbnail + ~48px footer
        return colWidth * 0.75 + 80;
    }, [columnCount]);

    // Read <main>'s cached scroll position so the virtualizer renders the
    // correct rows immediately (before the router restores scrollTop).
    const scrollEntry = useElementScrollRestoration({
        id: 'main-scroll-area',
    });

    const scrollMargin = gridRef.current?.offsetTop ?? 0;

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: estimateRowHeight,
        overscan: 1,
        scrollMargin,
        gap: GAP,
        initialOffset: scrollEntry?.scrollY,
    });

    // --- Infinite scroll trigger ---

    const virtualItems = virtualizer.getVirtualItems();
    const lastVirtualItemIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

    useEffect(() => {
        if (!hasNextPage || !fetchNextPage) return;

        if (lastVirtualItemIndex < 0) return;

        // Trigger when within 2 rows of the bottom
        if (lastVirtualItemIndex >= rowCount - 2) {
            fetchNextPage();
        }
    }, [lastVirtualItemIndex, hasNextPage, fetchNextPage, rowCount]);

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
                    const startIdx = virtualRow.index * columnCount;
                    const rowDocs = documents.slice(startIdx, startIdx + columnCount);

                    return (
                        <div
                            key={virtualRow.key}
                            className="absolute left-0 right-0 flex"
                            style={{
                                top: virtualRow.start - scrollMargin,
                                height: virtualRow.size,
                                gap: GAP,
                            }}
                        >
                            {rowDocs.map((doc) => (
                                <div key={doc.id} style={{ flex: `1 1 0%`, minWidth: 0 }}>
                                    <DocumentCard
                                        document={doc}
                                        orderedIds={orderedIds}
                                        shouldPulse={pulsingIds.has(doc.id)}
                                        onPulseComplete={() => handlePulseComplete(doc.id)}
                                    />
                                </div>
                            ))}
                            {/* Fill empty slots in the last row to maintain consistent card widths */}
                            {rowDocs.length < columnCount &&
                                Array.from({ length: columnCount - rowDocs.length }).map((_, i) => (
                                    <div key={`empty-${i}`} style={{ flex: `1 1 0%`, minWidth: 0 }} />
                                ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

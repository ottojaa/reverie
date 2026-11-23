import { useScrollContainer } from '@/lib/ScrollContainerContext';
import { useFetchNearEnd } from '@/lib/hooks/useFetchNearEnd';
import { flattenSectionTree, useSections } from '@/lib/sections';
import type { Document } from '@reverie/shared';
import { useElementScrollRestoration } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DocumentRow } from './DocumentRow';

const ROW_HEIGHT = 52;
const MIN_WIDTH = 640;

// Module-scoped like the grid's: a back-navigation remount starts from the previous offset, so the router's
// scroll restoration isn't clamped by a briefly too short list.
let cachedBodyOffsetTop = 0;

interface DocumentTableProps {
    documents: Document[];
    fetchNextPage?: () => void;
    hasNextPage?: boolean;
    /** Add the Folder column: only the library-wide view needs it, inside a folder every row is in that folder. */
    showFolder: boolean;
    /** Open at the scroll position the router remembered; false when the list is a different one than that was kept for. */
    restoreScroll?: boolean;
}

/** The Files tab: newest first by upload date (the order the server pages in), so no column sorts. */
export function DocumentTable({ documents, fetchNextPage, hasNextPage, showFolder, restoreScroll = true }: DocumentTableProps) {
    const scrollContainerRef = useScrollContainer();
    const bodyRef = useRef<HTMLDivElement>(null);
    const [scrollMargin, setScrollMargin] = useState(cachedBodyOffsetTop);
    const { data: sections } = useSections();
    const folderNames = useMemo(() => new Map(flattenSectionTree(sections ?? []).map((folder) => [folder.id, folder.name])), [sections]);
    const orderedIds = useMemo(() => documents.map((d) => d.id), [documents]);
    const columns = showFolder ? 'minmax(0, 1fr) 160px 96px 160px' : 'minmax(0, 1fr) 96px 160px';
    const scrollEntry = useElementScrollRestoration({ id: 'main-scroll-area' });

    // The body's distance from the top of the scrolling area: what sits above it (the page header) can change height,
    // so measure when the area or the page inside it resizes, not on every render (scrolling re-renders per row).
    useLayoutEffect(() => {
        const body = bodyRef.current;
        const container = scrollContainerRef.current;

        if (!body || !container) return;

        const measure = () => {
            const offset = Math.round(body.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop);
            cachedBodyOffsetTop = offset;
            setScrollMargin(offset);
        };

        measure();

        const observer = new ResizeObserver(measure);
        observer.observe(container);

        if (container.firstElementChild) observer.observe(container.firstElementChild);

        return () => observer.disconnect();
    }, [scrollContainerRef]);

    const virtualizer = useVirtualizer({
        count: documents.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => ROW_HEIGHT,
        getItemKey: (index) => documents[index]?.id ?? index,
        overscan: 6,
        scrollMargin,
        initialOffset: restoreScroll ? scrollEntry?.scrollY : undefined,
        paddingEnd: 60,
    });

    const virtualItems = virtualizer.getVirtualItems();

    useFetchNearEnd({
        lastRowIndex: virtualItems[virtualItems.length - 1]?.index ?? -1,
        rowCount: documents.length,
        hasNextPage,
        fetchNextPage,
    });

    return (
        <div className="overflow-x-auto rounded-xl bg-card">
            <div style={{ minWidth: MIN_WIDTH }}>
                <div
                    className="grid items-center gap-4 px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    style={{ gridTemplateColumns: columns }}
                >
                    <span>Name</span>
                    {showFolder && <span>Folder</span>}
                    <span className="text-right">Size</span>
                    <span className="text-foreground">Added ↓</span>
                </div>
                <div ref={bodyRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualItems.map((virtualRow) => {
                        const document = documents[virtualRow.index];

                        if (!document) return null;

                        return (
                            <DocumentRow
                                key={virtualRow.key}
                                document={document}
                                orderedIds={orderedIds}
                                columns={columns}
                                folderName={showFolder ? (document.folder_id ? (folderNames.get(document.folder_id) ?? null) : null) : undefined}
                                style={{ top: virtualRow.start - scrollMargin, height: virtualRow.size }}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

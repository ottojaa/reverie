import type { BrowseLayout } from '@/lib/browse/browse-layout';
import { emptyKindMessage } from '@/lib/browse/browse-kinds';
import type { Document, DocumentKind } from '@reverie/shared';
import { DocumentGrid } from './DocumentGrid';
import { DocumentRowsSkeleton, DocumentSkeleton } from './DocumentSkeleton';
import { DocumentTable } from './DocumentTable';

interface BrowseListProps {
    kind: DocumentKind;
    documents: Document[];
    isLoading: boolean;
    /** Loading has lasted long enough to be worth drawing placeholders (a fast load shows none). */
    showSkeleton: boolean;
    isFolderView: boolean;
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    /** Open at the scroll position the router remembered; false once the layout was switched here. */
    restoreScroll: boolean;
    /** How Photos and Videos draw their pictures. */
    layout: BrowseLayout;
}

/** What a kind view shows: the grid (Photos and Videos, with month headers) or the Files table. */
export function BrowseList({
    kind,
    documents,
    isLoading,
    showSkeleton,
    isFolderView,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    restoreScroll,
    layout,
}: BrowseListProps) {
    if (isLoading) return <LoadingList kind={kind} showSkeleton={showSkeleton} />;

    if (documents.length === 0) {
        return <p className="py-16 text-center text-sm text-muted-foreground">{emptyKindMessage(kind, isFolderView)}</p>;
    }

    const canFetchMore = hasNextPage && !isFetchingNextPage;

    return (
        <>
            {kind === 'file' ? (
                <DocumentTable
                    documents={documents}
                    fetchNextPage={fetchNextPage}
                    hasNextPage={canFetchMore}
                    showFolder={!isFolderView}
                    restoreScroll={restoreScroll}
                />
            ) : (
                <DocumentGrid documents={documents} fetchNextPage={fetchNextPage} hasNextPage={canFetchMore} restoreScroll={restoreScroll} layout={layout} />
            )}
            {isFetchingNextPage && (
                <div className="mt-4 flex justify-center">
                    <div className="aspect-4/3 h-8 w-24 animate-pulse rounded-xl bg-muted" />
                </div>
            )}
        </>
    );
}

function LoadingList({ kind, showSkeleton }: { kind: DocumentKind; showSkeleton: boolean }) {
    if (kind === 'file') {
        return (
            <div className={showSkeleton ? undefined : 'pointer-events-none opacity-0'} aria-hidden={!showSkeleton}>
                <DocumentRowsSkeleton />
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) =>
                showSkeleton ? (
                    <DocumentSkeleton key={i} />
                ) : (
                    <div key={i} className="opacity-0 pointer-events-none" aria-hidden>
                        <DocumentSkeleton />
                    </div>
                ),
            )}
        </div>
    );
}

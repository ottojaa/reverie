import { emptyTabMessage, type BrowseTab } from '@/lib/browse/browse-tabs';
import type { Document } from '@reverie/shared';
import { DocumentGrid } from './DocumentGrid';
import { DocumentRowsSkeleton, DocumentSkeleton } from './DocumentSkeleton';
import { DocumentTable } from './DocumentTable';
import { EmptyDocumentsState } from './EmptyDocumentsState';

interface BrowseListProps {
    tab: BrowseTab;
    documents: Document[];
    isLoading: boolean;
    /** Loading has lasted long enough to be worth drawing placeholders (a fast load shows none). */
    showSkeleton: boolean;
    isFolderView: boolean;
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    /** Open at the scroll position the router remembered; false once the tab was switched here. */
    restoreScroll: boolean;
}

/** What the open tab shows: the grid (All, Photos with month headers, Videos with month headers) or the Files table. */
export function BrowseList({
    tab,
    documents,
    isLoading,
    showSkeleton,
    isFolderView,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    restoreScroll,
}: BrowseListProps) {
    if (isLoading) return <LoadingList tab={tab} showSkeleton={showSkeleton} />;

    if (documents.length === 0) {
        return tab === 'all' ? (
            <EmptyDocumentsState isFolderView={isFolderView} />
        ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">{emptyTabMessage(tab, isFolderView)}</p>
        );
    }

    const canFetchMore = hasNextPage && !isFetchingNextPage;

    return (
        <>
            {tab === 'file' ? (
                <DocumentTable
                    documents={documents}
                    fetchNextPage={fetchNextPage}
                    hasNextPage={canFetchMore}
                    showFolder={!isFolderView}
                    restoreScroll={restoreScroll}
                />
            ) : (
                <DocumentGrid
                    documents={documents}
                    isLoading={false}
                    fetchNextPage={fetchNextPage}
                    hasNextPage={canFetchMore}
                    groupByMonth={tab !== 'all'}
                    restoreScroll={restoreScroll}
                />
            )}
            {isFetchingNextPage && (
                <div className="mt-4 flex justify-center">
                    <div className="aspect-4/3 h-8 w-24 animate-pulse rounded-xl bg-muted" />
                </div>
            )}
        </>
    );
}

function LoadingList({ tab, showSkeleton }: { tab: BrowseTab; showSkeleton: boolean }) {
    if (tab === 'file') {
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

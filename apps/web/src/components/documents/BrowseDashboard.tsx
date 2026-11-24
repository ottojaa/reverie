import { LockedFolderNotice } from '@/components/folders/LockedFolderNotice';
import { useDocuments, useDocumentSummary, useInfiniteDocuments } from '@/lib/api';
import { useLockedFolderPrompt } from '@/lib/hooks/useLockedFolderPrompt';
import { useCurrentSection } from '@/lib/sections';
import { useDelayedFlag } from '@/lib/hooks/useDelayedFlag';
import { useMemo } from 'react';
import { BrowseFrame } from './BrowseFrame';
import { BrowseHeader, FolderActions } from './BrowseHeader';
import { DocumentRowsSkeleton } from './DocumentSkeleton';
import { EmptyDocumentsState } from './EmptyDocumentsState';
import { KindCards } from './KindCards';
import { RecentTable } from './RecentTable';

const PHOTO_PREVIEWS = 6;
// A page folds into far fewer rows (a camera-roll batch is one), so a bigger first page is what fills the screen without a second request.
const RECENT_PAGE_SIZE = 50;
const SKELETON_DELAY_MS = 200;

interface BrowseDashboardProps {
    sectionId?: string | undefined;
}

/** Browse's front page: a card per kind (each opens its own view) over a Recently added table. */
export function BrowseDashboard({ sectionId }: BrowseDashboardProps) {
    const section = useCurrentSection(sectionId);
    const folderId = sectionId ?? null;
    // Recently added leads: its failure is what says a folder is locked, and the other queries then stand down.
    const recent = useInfiniteDocuments({ folderId, limit: RECENT_PAGE_SIZE });
    const { isLocked, unlock } = useLockedFolderPrompt(recent.error);
    const summary = useDocumentSummary(folderId, !isLocked);
    const photos = useDocuments({ folderId, kind: 'image', limit: PHOTO_PREVIEWS }, !isLocked);
    const videos = useDocuments({ folderId, kind: 'video', limit: 1 }, !isLocked);
    const documents = useMemo(() => recent.data?.pages.flatMap((page) => page.items) ?? [], [recent.data]);
    const showSkeleton = useDelayedFlag(recent.isLoading, SKELETON_DELAY_MS);
    const isEmpty = !recent.isLoading && !recent.error && documents.length === 0;
    const fileCount = summary.data ? summary.data.image.count + summary.data.video.count + summary.data.file.count : null;

    return (
        <BrowseFrame documents={documents}>
            <BrowseHeader section={section} subtitle={fileCount === null ? null : `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}>
                {sectionId && <FolderActions section={section} folderId={sectionId} isLoading={recent.isLoading} />}
            </BrowseHeader>

            {isLocked && <LockedFolderNotice onUnlock={unlock} />}

            {recent.error && !isLocked && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">Failed to load documents. Please try again.</div>
            )}

            {isEmpty && <EmptyDocumentsState isFolderView={!!sectionId} />}

            {!isLocked && !recent.error && !isEmpty && (
                <>
                    <KindCards summary={summary.data} photos={photos.data?.items ?? []} video={videos.data?.items[0]} />
                    <h2 className="mb-2.5 mt-7 text-lg font-semibold">Recently added</h2>
                    {recent.isLoading ? (
                        <div className={showSkeleton ? undefined : 'pointer-events-none opacity-0'} aria-hidden={!showSkeleton}>
                            <DocumentRowsSkeleton />
                        </div>
                    ) : (
                        <RecentTable
                            documents={documents}
                            scope={sectionId ?? 'library'}
                            showFolder={!sectionId}
                            fetchNextPage={recent.fetchNextPage}
                            hasNextPage={recent.hasNextPage && !recent.isFetchingNextPage}
                        />
                    )}
                </>
            )}
        </BrowseFrame>
    );
}

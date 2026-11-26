import { LockedFolderNotice } from '@/components/folders/LockedFolderNotice';
import { useDocuments, useDocumentSummary, useInfiniteDocuments } from '@/lib/api';
import { useLockedFolderPrompt } from '@/lib/hooks/useLockedFolderPrompt';
import { toOwnCount, toTotalCount } from '@/lib/folders/tree.js';
import { useCurrentSection } from '@/lib/sections';
import { useDelayedFlag } from '@/lib/hooks/useDelayedFlag';
import type { FolderWithChildren } from '@reverie/shared';
import { useMemo } from 'react';
import { BrowseFrame, LoadFailedBanner, SKELETON_DELAY_MS } from './BrowseFrame';
import { BrowseHeader, FolderActions } from './BrowseHeader';
import { DocumentRowsSkeleton } from './DocumentSkeleton';
import { EmptyDocumentsState } from './EmptyDocumentsState';
import { KindCards } from './KindCards';
import { RecentTable } from './RecentTable';
import { SubfolderList } from './SubfolderList';

const PHOTO_PREVIEWS = 6;
// A page folds into far fewer rows (a camera-roll batch is one), so a bigger first page is what fills the screen without a second request.
const RECENT_PAGE_SIZE = 50;

interface BrowseDashboardProps {
    sectionId?: string | undefined;
}

function toFileCountText(count: number): string {
    return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/** A folder counts its subfolders' files too, as the sidebar does, and says how many are further down: the page lists only its own. */
function toFolderSubtitle(folder: FolderWithChildren): string {
    const total = toTotalCount(folder);
    const below = total - toOwnCount(folder);

    return below > 0 ? `${toFileCountText(total)} · ${below} in subfolders` : toFileCountText(total);
}

/** Browse's front page: a card per kind (each opens its own view) over a Recently added table. */
export function BrowseDashboard({ sectionId }: BrowseDashboardProps) {
    const section = useCurrentSection(sectionId);
    const folderId = sectionId ?? null;
    // Recently added leads: its failure is what says a folder is locked, and the other queries then stand down.
    const recent = useInfiniteDocuments({ folderId, limit: RECENT_PAGE_SIZE });
    const { isLocked, unlock } = useLockedFolderPrompt(recent.error);
    const summary = useDocumentSummary(folderId, !isLocked);
    const photos = useDocuments({ folderId, kind: 'image', limit: PHOTO_PREVIEWS, preview: true }, !isLocked);
    const videos = useDocuments({ folderId, kind: 'video', limit: 1, preview: true }, !isLocked);
    const documents = useMemo(() => recent.data?.pages.flatMap((page) => page.items) ?? [], [recent.data]);
    const showSkeleton = useDelayedFlag(recent.isLoading, SKELETON_DELAY_MS);
    const isEmpty = !recent.isLoading && !recent.error && documents.length === 0;
    const subfolders = section?.children ?? [];
    const libraryCount = summary.data ? summary.data.image.count + summary.data.video.count + summary.data.file.count : null;
    const librarySubtitle = libraryCount === null ? null : toFileCountText(libraryCount);
    // A locked folder's counts are all zero, so it gets no subtitle.
    const folderSubtitle = section && !section.locked && !isLocked ? toFolderSubtitle(section) : null;

    return (
        <BrowseFrame documents={documents}>
            <BrowseHeader section={section} isLocked={isLocked} subtitle={sectionId ? folderSubtitle : librarySubtitle}>
                {sectionId && <FolderActions section={section} folderId={sectionId} isLoading={recent.isLoading} />}
            </BrowseHeader>

            {isLocked && <LockedFolderNotice onUnlock={unlock} />}

            {recent.error && !isLocked && <LoadFailedBanner />}

            {!isLocked && <SubfolderList folders={subfolders} />}

            {isEmpty && subfolders.length === 0 && <EmptyDocumentsState isFolderView={!!sectionId} />}

            {!isLocked && !recent.error && !isEmpty && (
                <>
                    {/* A failed summary leaves no cards rather than placeholders that pulse for good; the next invalidation retries it. */}
                    {!summary.isError && (
                        <KindCards summary={summary.data} photos={photos.data?.items ?? []} photoPreviewCount={PHOTO_PREVIEWS} video={videos.data?.items[0]} />
                    )}
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

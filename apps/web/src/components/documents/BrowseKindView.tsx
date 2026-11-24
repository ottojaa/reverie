import { LockedFolderNotice } from '@/components/folders/LockedFolderNotice';
import { Button } from '@/components/ui/button';
import { firstPageTotal, useInfiniteDocuments } from '@/lib/api';
import { hasLayoutChoice, type BrowseLayout } from '@/lib/browse/browse-layout';
import { kindSubtitle, kindTitle } from '@/lib/browse/browse-kinds';
import { useBrowseLayout } from '@/lib/browse/useBrowseLayout';
import { useDelayedFlag } from '@/lib/hooks/useDelayedFlag';
import { useLockedFolderPrompt } from '@/lib/hooks/useLockedFolderPrompt';
import { useScrollContainer } from '@/lib/ScrollContainerContext';
import { useCurrentSection } from '@/lib/sections';
import { useSelectionOptional } from '@/lib/selection';
import type { DocumentKind } from '@reverie/shared';
import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BrowseFrame } from './BrowseFrame';
import { BrowseHeader } from './BrowseHeader';
import { BrowseLayoutSwitch } from './BrowseLayoutSwitch';
import { BrowseList } from './BrowseList';

const SKELETON_DELAY_MS = 200;

interface BrowseKindViewProps {
    kind: DocumentKind;
    sectionId?: string | undefined;
}

/** One kind's own view, opened from a dashboard card: all its documents, with a way back. */
export function BrowseKindView({ kind, sectionId }: BrowseKindViewProps) {
    const section = useCurrentSection(sectionId);
    const selection = useSelectionOptional();
    const scrollContainerRef = useScrollContainer();
    const [layout, setLayout] = useBrowseLayout();
    // The router remembers one scroll position per page: it belongs to the layout that was open, so a layout switched to here starts at the top.
    const [hasSwitchedLayout, setHasSwitchedLayout] = useState(false);
    const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteDocuments({ folderId: sectionId ?? null, kind });
    const { isLocked, unlock } = useLockedFolderPrompt(error);
    // Memoized: a new array on every render (each selection click) would rebuild every row below.
    const documents = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
    const total = firstPageTotal(data);
    const showSkeleton = useDelayedFlag(isLoading, SKELETON_DELAY_MS);

    const handleLayoutChange = (next: BrowseLayout) => {
        if (next === layout) return;

        selection?.clear();
        scrollContainerRef.current?.scrollTo({ top: 0 });
        setHasSwitchedLayout(true);
        setLayout(next);
    };

    return (
        <BrowseFrame documents={documents}>
            <BrowseHeader
                section={section}
                title={kindTitle(kind)}
                subtitle={total ? kindSubtitle(kind, total, section ? section.name : 'My Files') : null}
                back={<BackToDashboard />}
            >
                {hasLayoutChoice(kind) && <BrowseLayoutSwitch layout={layout} onChange={handleLayoutChange} />}
            </BrowseHeader>
            <div className="mt-6">
                {isLocked && <LockedFolderNotice onUnlock={unlock} />}

                {error && !isLocked && (
                    <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
                        Failed to load documents. Please try again.
                    </div>
                )}

                {!isLocked && !error && (
                    <BrowseList
                        key={`${kind}:${layout}`}
                        kind={kind}
                        layout={layout}
                        documents={documents}
                        isLoading={isLoading}
                        showSkeleton={showSkeleton}
                        isFolderView={!!sectionId}
                        fetchNextPage={fetchNextPage}
                        hasNextPage={hasNextPage}
                        isFetchingNextPage={isFetchingNextPage}
                        restoreScroll={!hasSwitchedLayout}
                    />
                )}
            </div>
        </BrowseFrame>
    );
}

/**
 * Back to the dashboard. From a card it is the browser's back, so the dashboard returns as it was left (scroll,
 * opened groups); on a kind view opened any other way (a pasted link, a reload with no history) it is a link to it.
 */
function BackToDashboard() {
    const router = useRouter();
    const cameFromCard = useLocation({ select: (location) => location.state.fromBrowseDashboard === true });

    if (cameFromCard && router.history.canGoBack()) {
        return (
            <Button variant="ghost" size="icon" aria-label="Back to Browse" onClick={() => router.history.back()}>
                <ArrowLeft className="size-5" />
            </Button>
        );
    }

    return (
        <Button variant="ghost" size="icon" aria-label="Back to Browse" asChild>
            <Link to="." search={{}}>
                <ArrowLeft className="size-5" />
            </Link>
        </Button>
    );
}

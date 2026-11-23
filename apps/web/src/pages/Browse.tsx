import { BrowseHeader } from '@/components/documents/BrowseHeader';
import { BrowseList } from '@/components/documents/BrowseList';
import { SelectionBanner } from '@/components/documents';
import { LockedFolderNotice } from '@/components/folders/LockedFolderNotice';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { UploadFAB } from '@/components/upload';
import { firstPageTotal, useInfiniteDocuments } from '@/lib/api';
import { isBrowseTab, kindOfTab, tabSubtitle } from '@/lib/browse/browse-tabs';
import { useBrowseTab } from '@/lib/browse/useBrowseTab';
import { useLockedFolderPrompt } from '@/lib/hooks/useLockedFolderPrompt';
import { useScrollContainer } from '@/lib/ScrollContainerContext';
import { useCurrentSection } from '@/lib/sections';
import { useSelectionOptional } from '@/lib/selection';
import { useEffect, useMemo, useState } from 'react';

const SKELETON_DELAY_MS = 200;

export interface BrowsePageProps {
    sectionId?: string;
}

export function BrowsePage({ sectionId }: BrowsePageProps) {
    const section = useCurrentSection(sectionId);
    const selection = useSelectionOptional();
    const scrollContainerRef = useScrollContainer();
    const [tab, setTab] = useBrowseTab();
    // The router remembers one scroll position per page: it belongs to the tab that was open, so a tab switched to here starts at the top.
    const [hasSwitchedTab, setHasSwitchedTab] = useState(false);

    useEffect(() => {
        if (!selection) return;

        const handler = (e: MouseEvent) => {
            const target = e.target instanceof Node ? e.target : null;

            if (target && (target as Element).closest?.('[data-document-card]')) return;

            selection.clear();
        };

        document.addEventListener('click', handler);

        return () => document.removeEventListener('click', handler);
    }, [selection]);

    const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteDocuments({
        ...(sectionId && { folderId: sectionId }),
        kind: kindOfTab(tab),
    });

    const { isLocked, unlock } = useLockedFolderPrompt(error);

    // Memoized: a new array on every render (each selection click) would rebuild every row below.
    const documents = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
    const total = firstPageTotal(data);

    // Only show skeleton if loading lasts longer than SKELETON_DELAY_MS (avoids flash on fast loads)
    const [showSkeleton, setShowSkeleton] = useState(false);
    useEffect(() => {
        if (!isLoading) {
            setShowSkeleton(false);

            return;
        }

        const t = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);

        return () => clearTimeout(t);
    }, [isLoading]);

    const handleTabChange = (next: string) => {
        if (!isBrowseTab(next) || next === tab) return;

        selection?.clear();
        scrollContainerRef.current?.scrollTo({ top: 0 });
        setHasSwitchedTab(true);
        setTab(next);
    };

    const hasSelection = (selection?.selectedIds.size ?? 0) > 0;

    return (
        <div className="relative flex min-h-full flex-col">
            <div className={`flex-1 p-6 transition-[padding-bottom] duration-200 ${hasSelection ? 'pb-24' : ''}`}>
                <Tabs value={tab} onValueChange={handleTabChange} className="gap-0">
                    <BrowseHeader
                        section={section}
                        sectionId={sectionId}
                        subtitle={total ? tabSubtitle(tab, total) : null}
                        documents={documents}
                        isLoading={isLoading}
                    />

                    {isLocked && <LockedFolderNotice onUnlock={unlock} />}

                    {error && !isLocked && (
                        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
                            Failed to load documents. Please try again.
                        </div>
                    )}

                    {!isLocked && !error && (
                        <TabsContent value={tab}>
                            <BrowseList
                                tab={tab}
                                documents={documents}
                                isLoading={isLoading}
                                showSkeleton={showSkeleton}
                                isFolderView={!!sectionId}
                                fetchNextPage={fetchNextPage}
                                hasNextPage={hasNextPage}
                                isFetchingNextPage={isFetchingNextPage}
                                restoreScroll={!hasSwitchedTab}
                            />
                        </TabsContent>
                    )}
                </Tabs>
                <UploadFAB />
            </div>
            <SelectionBanner documents={documents} />
        </div>
    );
}

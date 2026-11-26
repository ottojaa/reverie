import { FilterMenuButton } from '@/components/search/filter-bar/FilterMenuButton';
import { SearchResultItem } from '@/components/search/SearchResultItem';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useInfiniteSearch } from '@/lib/api/search';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import { useSections } from '@/lib/sections';
import { cn } from '@/lib/utils';
import type { DocumentSearchResult, SearchResult } from '@reverie/shared';
import { Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { FolderPickerPanel, type MoveDestination } from './FolderPickerPanel';
import { useMoveToDestination } from './useMoveToDestination';

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);

    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');

        const handler = () => setIsDesktop(mq.matches);

        mq.addEventListener('change', handler);

        return () => mq.removeEventListener('change', handler);
    }, []);

    return isDesktop;
}

function FloatingSelectionBar({
    selectedResults,
    selectedCount,
    onClear,
    onMove,
}: {
    selectedResults: SearchResult[];
    selectedCount: number;
    onClear: () => void;
    onMove: () => void;
}) {
    const thumbnails = selectedResults.slice(0, 3);

    return (
        <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.2 }}
            className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg"
        >
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="flex -space-x-1.5 shrink-0">
                    {thumbnails.map((r, i) => {
                        const url = getThumbnailUrl(r, 'sm');

                        return (
                            <div
                                key={r.document_id}
                                className="size-8 rounded-full overflow-hidden border-2 border-card bg-secondary shrink-0"
                                style={{ zIndex: thumbnails.length - i }}
                            >
                                {url ? (
                                    <img src={url} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                        <span className="text-[8px] font-medium uppercase text-muted-foreground">{r.format}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                <span className="text-sm font-medium text-foreground truncate">
                    {selectedCount} {selectedCount === 1 ? 'selected' : 'selected'}
                </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection">
                    <X className="size-4" />
                </Button>
                <Button size="sm" onClick={onMove}>
                    Move to folder →
                </Button>
            </div>
        </motion.div>
    );
}

function MoveToFolderDrawer({
    open,
    onOpenChange,
    selectedResults,
    ...pickerProps
}: ComponentProps<typeof FolderPickerPanel> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedResults: SearchResult[];
}) {
    const isDesktop = useIsDesktop();
    const thumbnails = selectedResults.slice(0, 5);

    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction={isDesktop ? 'right' : 'bottom'}>
            <DrawerContent
                className={cn('flex flex-col border-border', isDesktop ? 'h-full max-h-none w-80 max-w-[90vw] rounded-none' : 'max-h-[85vh] rounded-t-xl')}
            >
                <DrawerHeader className="shrink-0 border-b border-border px-4 py-3 gap-2">
                    <DrawerTitle className="text-sm font-medium">Move to folder</DrawerTitle>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                        {thumbnails.map((r) => {
                            const url = getThumbnailUrl(r, 'md');

                            return (
                                <div key={r.document_id} className="size-10 shrink-0 overflow-hidden rounded-md border border-border bg-secondary">
                                    {url ? (
                                        <img src={url} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                            <span className="text-[8px] font-medium uppercase text-muted-foreground">{r.format}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {selectedResults.length > 5 && (
                            <span className="shrink-0 self-center pl-1 text-xs text-muted-foreground">+{selectedResults.length - 5}</span>
                        )}
                    </div>
                </DrawerHeader>
                <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
                    <FolderPickerPanel {...pickerProps} />
                </div>
            </DrawerContent>
        </Drawer>
    );
}

export function OrganizeManual() {
    const [query, setQuery] = useState('');
    const [activeQuery, setActiveQuery] = useState('');
    const [folderId, setFolderId] = useState<string>();
    const hasFilter = Boolean(activeQuery || folderId);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [drawerOpen, setDrawerOpen] = useState(false);
    // Undefined while nothing is picked; null is the top level.
    const [targetFolderId, setTargetFolderId] = useState<string | null>();
    const { data: sectionsData } = useSections();
    const sections = sectionsData ?? [];

    const { data: searchData, isLoading } = useInfiniteSearch({
        q: activeQuery,
        ...(folderId && { folder_id: folderId }),
        include_facets: false,
        limit: 30,
        sort_by: 'uploaded',
        sort_order: 'desc',
    });

    // Organize only operates on documents; folders never appear here (sort_by is not 'relevance').
    const results = useMemo(
        () => (searchData?.pages.flatMap((p) => p.results) ?? []).filter((r): r is DocumentSearchResult => r.result_type === 'document'),
        [searchData],
    );

    const selectedResults = useMemo(() => results.filter((r) => selectedIds.has(r.document_id)), [results, selectedIds]);

    useEffect(() => {
        setActiveQuery(query);
    }, [query]);

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }

            return next;
        });
    };

    const selectAll = () => setSelectedIds(new Set(results.map((r) => r.document_id)));
    const clearSelection = () => setSelectedIds(new Set());

    const { moveTo, isMoving } = useMoveToDestination(sections);

    const handleConfirmMove = async (destination: MoveDestination) => {
        const documentIds = selectedResults.map((r) => r.document_id);

        if (documentIds.length === 0 || !(await moveTo(documentIds, destination))) return;

        setDrawerOpen(false);
        setSelectedIds(new Set());
    };

    const hasSelection = selectedIds.size > 0;

    return (
        <div className="relative flex h-full flex-col overflow-hidden">
            {/* Search bar */}
            <div className="shrink-0 border-b border-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && setActiveQuery(query)}
                            placeholder="Filter documents..."
                            className="pl-8"
                        />
                    </div>
                    <FilterMenuButton query={query} onQueryChange={setQuery} folderId={folderId} onFolderChange={setFolderId} />
                </div>
            </div>

            {/* Results area */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {results.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b border-border sticky top-0 z-1 bg-background">
                        <span>
                            {results.length} results · {selectedIds.size} selected
                        </span>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={selectAll}>
                                Select all
                            </Button>
                            {hasSelection && (
                                <Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={clearSelection}>
                                    Clear
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {isLoading ? (
                    <div className="py-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                                <Skeleton className="size-4 rounded shrink-0" />
                                <Skeleton className="size-9 rounded shrink-0" />
                                <div className="flex-1 min-w-0 space-y-1">
                                    <Skeleton className="h-3.5 w-3/4" />
                                    <Skeleton className="h-3 w-1/2" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : results.length === 0 && hasFilter ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Search className="size-6 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No documents found</p>
                        <p className="text-xs text-muted-foreground/60">Try different filters</p>
                    </div>
                ) : !hasFilter ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Search className="size-6 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">Use filters to find documents to organize</p>
                    </div>
                ) : (
                    <div>
                        {results.map((result) => (
                            <SearchResultItem key={result.document_id} result={result} selected={selectedIds.has(result.document_id)} onToggle={toggleSelect} />
                        ))}
                    </div>
                )}
            </div>

            <AnimatePresence>
                {hasSelection && (
                    <FloatingSelectionBar
                        selectedResults={selectedResults}
                        selectedCount={selectedIds.size}
                        onClear={clearSelection}
                        onMove={() => setDrawerOpen(true)}
                    />
                )}
            </AnimatePresence>

            <MoveToFolderDrawer
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                selectedResults={selectedResults}
                sections={sections}
                selected={targetFolderId}
                onSelect={setTargetFolderId}
                onConfirm={(destination) => void handleConfirmMove(destination)}
                isPending={isMoving}
            />
        </div>
    );
}

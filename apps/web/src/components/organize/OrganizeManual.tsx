import { SearchFilterPopover } from '@/components/search/SearchFilterPopover';
import { SearchResultItem } from '@/components/search/SearchResultItem';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useExecuteOrganize } from '@/lib/api/organize';
import { useInfiniteSearch } from '@/lib/api/search';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import { useSections } from '@/lib/sections';
import { cn } from '@/lib/utils';
import type { FolderWithChildren, OrganizeOperation, SearchResult } from '@reverie/shared';
import { Check, ChevronDown, FolderPlus, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SectionIcon } from '../ui/SectionIcon';

const NEW_FOLDER_SENTINEL = '__new__';

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

function FolderPickerPanel({
    sections,
    selectedId,
    selectedName,
    onSelect,
    onConfirm,
    isPending,
}: {
    sections: FolderWithChildren[];
    selectedId: string | null;
    selectedName: string;
    onSelect: (id: string, name: string, parentId?: string) => void;
    onConfirm: () => void;
    isPending?: boolean;
}) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(sections.map((s) => s.id)));
    const [showNewForm, setShowNewForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newParentId, setNewParentId] = useState<string | null>(sections[0]?.id ?? null);

    const toggleCategory = (id: string) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev);

            if (next.has(id)) next.delete(id);
            else next.add(id);

            return next;
        });
    };

    const handleCreate = () => {
        if (!newName.trim() || !newParentId) return;

        onSelect(NEW_FOLDER_SENTINEL, newName.trim(), newParentId);
        setShowNewForm(false);
        setNewName('');
    };

    const canConfirm = selectedId !== null && selectedName.trim().length > 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-1">
                    {sections.map((category) => (
                        <div key={category.id} className="rounded-md">
                            <Button
                                type="button"
                                variant="ghost"
                                className="group w-full justify-start gap-1.5 px-2 py-1.5 text-left hover:bg-secondary/80"
                                onClick={() => toggleCategory(category.id)}
                            >
                                <span className="flex shrink-0 items-center justify-center text-muted-foreground">
                                    <motion.span
                                        initial={false}
                                        animate={{ rotate: expandedCategories.has(category.id) ? 0 : -90 }}
                                        transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                                    >
                                        <ChevronDown className="size-3.5" />
                                    </motion.span>
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {category.name}
                                </span>
                            </Button>
                            <AnimatePresence initial={false}>
                                {expandedCategories.has(category.id) && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                                        className="overflow-hidden"
                                    >
                                        <div className="space-y-px pb-1">
                                            {category.children.map((section) => (
                                                <Button
                                                    key={section.id}
                                                    type="button"
                                                    variant="ghost"
                                                    className={cn(
                                                        'w-full justify-start gap-2 px-2 py-1.5 pl-6 text-left text-sm hover:bg-secondary/80',
                                                        selectedId === section.id
                                                            ? 'border-l-2 border-l-primary bg-primary/8 text-primary'
                                                            : 'border-l-2 border-l-transparent',
                                                    )}
                                                    onClick={() => onSelect(section.id, section.name, category.id)}
                                                >
                                                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                                        <SectionIcon value={section.emoji} className="shrink-0" />
                                                        <span className="min-w-0 truncate font-medium">{section.name}</span>
                                                    </div>
                                                    {selectedId === section.id && <Check className="size-4 shrink-0 text-primary" />}
                                                </Button>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                </div>

                {/* New folder */}
                <div className="mt-2 border-t border-border pt-2">
                    {showNewForm ? (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="p-3 space-y-2 overflow-hidden"
                        >
                            <Input
                                autoFocus
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                placeholder="New folder name"
                            />
                            <select
                                value={newParentId ?? ''}
                                onChange={(e) => setNewParentId(e.target.value)}
                                className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
                            >
                                {sections.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                        {cat.name}
                                    </option>
                                ))}
                            </select>
                            <div className="flex gap-2">
                                <Button size="sm" className="flex-1" onClick={handleCreate} disabled={!newName.trim()}>
                                    Create
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setShowNewForm(false)}>
                                    <X className="size-4" />
                                </Button>
                            </div>
                        </motion.div>
                    ) : (
                        <Button
                            type="button"
                            variant="ghost"
                            className={cn(
                                'w-full justify-start gap-2 rounded-md px-3 py-2.5 text-sm',
                                selectedId === NEW_FOLDER_SENTINEL && 'bg-primary/8 text-primary',
                            )}
                            onClick={() => {
                                onSelect(NEW_FOLDER_SENTINEL, '', undefined);
                                setShowNewForm(true);
                            }}
                        >
                            <FolderPlus className="size-4 shrink-0" />
                            New folder
                        </Button>
                    )}
                </div>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3">
                <Button onClick={onConfirm} disabled={!canConfirm || isPending} className="w-full">
                    {isPending ? 'Moving...' : canConfirm ? `Move to "${selectedName}"` : 'Select a folder'}
                </Button>
            </div>
        </div>
    );
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
    sections,
    targetFolderId,
    targetFolderName,
    onFolderSelect,
    onConfirm,
    isPending,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedResults: SearchResult[];
    sections: FolderWithChildren[];
    targetFolderId: string | null;
    targetFolderName: string;
    onFolderSelect: (id: string, name: string, parentId?: string) => void;
    onConfirm: () => void;
    isPending?: boolean;
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
                    <FolderPickerPanel
                        sections={sections}
                        selectedId={targetFolderId}
                        selectedName={targetFolderName}
                        onSelect={onFolderSelect}
                        onConfirm={onConfirm}
                        isPending={isPending}
                    />
                </div>
            </DrawerContent>
        </Drawer>
    );
}

export function OrganizeManual() {
    const [query, setQuery] = useState('');
    const [activeQuery, setActiveQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
    const [targetFolderName, setTargetFolderName] = useState('');
    const [targetParentId, setTargetParentId] = useState<string | undefined>(undefined);
    const [isNewFolder, setIsNewFolder] = useState(false);
    const { data: sectionsData } = useSections();
    const sections = sectionsData ?? [];

    const { data: searchData, isLoading } = useInfiniteSearch({
        q: activeQuery,
        include_facets: true,
        limit: 30,
        sort_by: 'uploaded',
        sort_order: 'desc',
    });

    const results = useMemo(() => searchData?.pages.flatMap((p) => p.results) ?? [], [searchData]);
    const facets = searchData?.pages[0]?.facets;

    const selectedResults = useMemo(() => results.filter((r) => selectedIds.has(r.document_id)), [results, selectedIds]);

    useEffect(() => {
        setActiveQuery(query);
    }, [query]);

    const addFilter = useCallback((filter: string) => {
        setQuery((q) => (q ? `${q} ${filter}` : filter));
    }, []);

    const removeFilter = useCallback((filter: string) => {
        setQuery((q) => q.replace(filter, '').trim());
    }, []);

    const replaceFilter = useCallback((prefix: string, newValue: string) => {
        const regex = new RegExp(`(?:^|\\s)-?${prefix}:(?:"[^"]+"|\\S+)`, 'g');
        setQuery((q) => q.replace(regex, '').trim() + ` ${newValue}`);
    }, []);

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

    const handleFolderSelect = (id: string, name: string, parentId?: string) => {
        setTargetFolderId(id);
        setTargetFolderName(name);
        setTargetParentId(parentId);
        setIsNewFolder(id === NEW_FOLDER_SENTINEL);
    };

    const execute = useExecuteOrganize();

    const handleConfirmMove = async () => {
        if (selectedResults.length === 0 || !targetFolderName.trim()) return;

        const operation: OrganizeOperation = {
            type: isNewFolder ? 'create_and_move' : 'move',
            document_ids: selectedResults.map((r) => r.document_id),
            document_previews: selectedResults.map((r) => ({
                id: r.document_id,
                display_name: r.display_name,
                thumbnail_urls: r.thumbnail_urls,
                mime_type: r.mime_type,
            })),
            target_folder: {
                id: isNewFolder ? undefined : (targetFolderId ?? undefined),
                name: targetFolderName,
                parent_id: targetParentId,
                is_new: isNewFolder,
            },
        };

        try {
            await execute.mutateAsync([operation]);
            const n = selectedResults.length;
            toast.success(`Moved ${n} ${n === 1 ? 'document' : 'documents'} to "${targetFolderName}"`);
            setDrawerOpen(false);
            setSelectedIds(new Set());
        } catch {
            toast.error('Failed to move documents');
        }
    };

    const hasSelection = selectedIds.size > 0;

    return (
        <div className="flex h-full flex-col overflow-hidden">
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
                    <SearchFilterPopover
                        currentQuery={query}
                        facets={facets}
                        onAddFilter={addFilter}
                        onRemoveFilter={removeFilter}
                        onReplaceFilter={replaceFilter}
                    />
                </div>
            </div>

            {/* Results area */}
            <div className="relative min-h-0 flex-1 overflow-y-auto pb-24">
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
                ) : results.length === 0 && activeQuery ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Search className="size-6 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No documents found</p>
                        <p className="text-xs text-muted-foreground/60">Try different filters</p>
                    </div>
                ) : !activeQuery ? (
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

                <AnimatePresence>
                    {hasSelection && sections.length > 0 && (
                        <FloatingSelectionBar
                            selectedResults={selectedResults}
                            selectedCount={selectedIds.size}
                            onClear={clearSelection}
                            onMove={() => setDrawerOpen(true)}
                        />
                    )}
                </AnimatePresence>
            </div>

            <MoveToFolderDrawer
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                selectedResults={selectedResults}
                sections={sections}
                targetFolderId={targetFolderId}
                targetFolderName={targetFolderName}
                onFolderSelect={handleFolderSelect}
                onConfirm={handleConfirmMove}
                isPending={execute.isPending}
            />
        </div>
    );
}

import type { SortableTreeHandlers } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { documentsApi } from '@/lib/api/documents';
import { FOLDER_DROP_PREFIX, useMoveDocuments } from '@/lib/sections';
import { useSelectionOptional } from '@/lib/selection';
import { cn } from '@/lib/utils';
import type { DragEndEvent, DragOverEvent, DragStartEvent, DropAnimation } from '@dnd-kit/core';
import { defaultDropAnimation, DragOverlay } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Document, FolderWithChildren } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { produce } from 'immer';
import { Plus, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { DuplicateOptionsDialog } from '../upload/DuplicateOptionsDialog';
import { categoryIdToSortableId, CategoryItem, sortableIdToCategoryId } from './CategoryItem';
import { SectionItem } from './SectionItem';

interface CategorizedSectionsProps {
    sections: FolderWithChildren[];
    currentSectionId?: string;
    onSectionsChange?: (updates: Array<{ id: string; sort_order: number }>, parentChanges?: Array<{ id: string; parent_id: string }>) => void;
    onEditSection?: (section: FolderWithChildren) => void;
    onEditCategory?: (category: FolderWithChildren) => void;
    onAddSection?: (category: FolderWithChildren) => void;
    onAddCollection?: () => void;
    onDeleteSection?: (section: FolderWithChildren) => void;
    onDeleteCategory?: (category: FolderWithChildren) => void;
    onClose?: () => void;
    treeDndHandlersRef?: RefObject<SortableTreeHandlers | null>;
}

type ActiveDragData =
    | { type: 'collection'; category: FolderWithChildren }
    | { type: 'folder'; section: FolderWithChildren }
    | { type: 'documents'; documentIds: string[] }
    | null;

/** Delay before clearing overlay so drop animation can complete (default 250ms + buffer). */
const DROP_ANIMATION_DURATION_MS = 300;

const dropAnimationConfig: DropAnimation = {
    keyframes({ transform }) {
        return [
            { opacity: 1, transform: CSS.Transform.toString(transform.initial) },
            {
                opacity: 0,
                transform: CSS.Transform.toString({
                    ...transform.final,
                    x: transform.final.x + 5,
                    y: transform.final.y + 5,
                }),
            },
        ];
    },
    easing: 'ease-out',
    sideEffects({ active }) {
        active.node.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: defaultDropAnimation.duration,
            easing: defaultDropAnimation.easing,
        });
    },
};

export function CategorizedSections({
    sections,
    currentSectionId,
    onSectionsChange,
    onEditSection,
    onEditCategory,
    onAddSection,
    onAddCollection,
    onDeleteSection,
    onDeleteCategory,
    onClose,
    treeDndHandlersRef,
}: CategorizedSectionsProps) {
    // Categories are root-level items (type=category), sections are their children
    const [categories, setCategories] = useState<FolderWithChildren[]>(() => sections);
    const categoriesRef = useRef(categories);
    categoriesRef.current = categories;
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [treeFilter, setTreeFilter] = useState('');
    const [activeDragData, setActiveDragData] = useState<ActiveDragData>(null);

    // Sync when parent data changes: always when not dragging; when dragging, only if structure changed
    useEffect(() => {
        const currentIds = new Set(categoriesRef.current.flatMap((c) => [c.id, ...c.children.map((s) => s.id)]));
        const newIds = new Set(sections.flatMap((c) => [c.id, ...c.children.map((s) => s.id)]));
        const structureChanged = currentIds.size !== newIds.size || [...currentIds].some((id) => !newIds.has(id));

        const shouldSync = !activeDragData || structureChanged;

        if (shouldSync) {
            setCategories(sections);
        }
    }, [sections, activeDragData]);

    const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);
    const [moveDuplicateState, setMoveDuplicateState] = useState<{
        duplicateFilenames: string[];
        documentIds: string[];
        folderId: string;
    } | null>(null);

    const moveDocuments = useMoveDocuments();
    const selection = useSelectionOptional();
    const queryClient = useQueryClient();

    const filterTrimmed = treeFilter.trim();
    const filterActive = filterTrimmed.length > 0;

    const filteredCategories = useMemo(() => filterFolderTree(categories, filterTrimmed), [categories, filterTrimmed]);

    // Sortable IDs for categories (prefixed) and sections — must match rendered list
    const categoryIds = useMemo(() => filteredCategories.map((c) => categoryIdToSortableId(c.id)), [filteredCategories]);

    const toggleCollapse = useCallback((categoryId: string) => {
        setCollapsed((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
    }, []);

    // ---- DnD Handlers ----

    function handleDragStart({ active }: DragStartEvent) {
        const data = active.data.current;

        if (data?.type === 'collection') {
            setActiveDragData({ type: 'collection', category: data.category });
        }

        if (data?.type === 'folder') {
            setActiveDragData({ type: 'folder', section: data.section });
        }

        if (data?.type === 'documents' && Array.isArray(data.documentIds)) {
            setActiveDragData({ type: 'documents', documentIds: data.documentIds });
        }

        document.body.style.setProperty('cursor', 'grabbing');
    }

    function handleDragOver({ active, over }: DragOverEvent) {
        if (!over) {
            setHighlightedSectionId(null);

            return;
        }

        const activeData = active.data.current;
        const overData = over.data.current;

        if (activeData?.type === 'documents') {
            setHighlightedSectionId(getDocumentDropHighlightId(String(over.id), overData));

            return;
        }

        if (activeData?.type !== 'folder' || !overData) return;

        const activeSectionId = String(active.id);
        const targetCategoryId = overData.type === 'collection' ? overData.category.id : findParentCategoryId(categoriesRef.current, String(over.id));

        if (!targetCategoryId) return;

        const sourceCategoryId = findParentCategoryId(categoriesRef.current, activeSectionId);

        if (!sourceCategoryId || sourceCategoryId === targetCategoryId) return;

        setCategories((prev) => moveSectionBetweenCategories(prev, activeSectionId, sourceCategoryId, targetCategoryId));
    }

    function handleDragEnd({ active, over }: DragEndEvent) {
        const activeData = active.data.current;

        if (activeData?.type === 'documents' && over) {
            handleDocumentDropEnd(activeData as { type: 'documents'; documentIds: string[] }, over);
            setTimeout(resetState, DROP_ANIMATION_DURATION_MS);

            return;
        }

        if (activeData?.type === 'collection' && over) {
            handleCategoryReorderEnd(active.id, over.id);
            setTimeout(resetState, DROP_ANIMATION_DURATION_MS);

            return;
        }

        if (activeData?.type === 'folder' && over) {
            handleSectionReorderEnd(active.id, over);
            setTimeout(resetState, DROP_ANIMATION_DURATION_MS);

            return;
        }

        setTimeout(resetState, DROP_ANIMATION_DURATION_MS);
    }

    async function handleDocumentDropEnd(
        activeData: { type: 'documents'; documentIds: string[] },
        over: { id: string | number; data?: { current?: unknown } },
    ) {
        const targetSectionId = (over.data?.current as { type?: string })?.type === 'folder' ? String(over.id) : null;

        if (!targetSectionId || activeData.documentIds.length === 0) return;

        const filenames = getDocumentFilenamesFromCache(queryClient, activeData.documentIds);

        if (filenames.length === 0) {
            moveDocuments.mutate(
                { document_ids: activeData.documentIds, folder_id: targetSectionId },
                {
                    onSuccess: () => {
                        selection?.clear();
                        toast.success(
                            activeData.documentIds.length === 1 ? '1 file moved successfully' : `${activeData.documentIds.length} files moved successfully`,
                        );
                    },
                },
            );

            return;
        }

        try {
            const { duplicates } = await documentsApi.checkDuplicates(targetSectionId, filenames);

            if (duplicates.length > 0) {
                setMoveDuplicateState({
                    duplicateFilenames: duplicates,
                    documentIds: activeData.documentIds,
                    folderId: targetSectionId,
                });
            } else {
                doMove(activeData.documentIds, targetSectionId);
            }
        } catch {
            toast.error('Failed to check for duplicates');
            doMove(activeData.documentIds, targetSectionId);
        }
    }

    function doMove(documentIds: string[], folderId: string, conflictStrategy?: 'replace' | 'keep_both') {
        moveDocuments.mutate(
            { document_ids: documentIds, folder_id: folderId, ...(conflictStrategy && { conflict_strategy: conflictStrategy }) },
            {
                onSuccess: () => {
                    selection?.clear();
                    toast.success(documentIds.length === 1 ? '1 file moved successfully' : `${documentIds.length} files moved successfully`);
                },
            },
        );
    }

    function handleCategoryReorderEnd(activeId: string | number, overId: string | number) {
        const activeSortableId = String(activeId);
        const overSortableId = String(overId);

        if (activeSortableId === overSortableId) return;

        const activeCatId = sortableIdToCategoryId(activeSortableId);
        const overCatId = sortableIdToCategoryId(overSortableId);

        if (!activeCatId || !overCatId) return;

        const prev = categoriesRef.current;
        const oldIndex = prev.findIndex((c) => c.id === activeCatId);
        const newIndex = prev.findIndex((c) => c.id === overCatId);

        if (oldIndex === -1 || newIndex === -1) return;

        const next = produce(prev, (draft) => {
            const [moved] = draft.splice(oldIndex, 1);
            draft.splice(newIndex, 0, moved!);
        });
        setCategories(next);
        persistOrderFrom(next);
    }

    function handleSectionReorderEnd(activeId: string | number, over: { id: string | number; data?: { current?: unknown } }) {
        const activeSectionId = String(activeId);
        const isOverSection = (over.data?.current as { type?: string })?.type === 'folder';
        const needsReorder = isOverSection && activeSectionId !== String(over.id);

        if (!needsReorder) {
            persistOrderFrom(categoriesRef.current);

            return;
        }

        const categoryId = findParentCategoryId(categoriesRef.current, activeSectionId);

        if (!categoryId) return;

        const prev = categoriesRef.current;
        const next = produce(prev, (draft) => {
            const cat = draft.find((c) => c.id === categoryId);

            if (!cat) return;

            const oldIndex = cat.children.findIndex((s) => s.id === activeSectionId);
            const newIndex = cat.children.findIndex((s) => s.id === String(over.id));

            if (oldIndex === -1 || newIndex === -1) return;

            const [moved] = cat.children.splice(oldIndex, 1);
            cat.children.splice(newIndex, 0, moved!);
        });

        setCategories(next);
        persistOrderFrom(next);
    }

    function handleDragCancel() {
        setTimeout(resetState, DROP_ANIMATION_DURATION_MS);
    }

    function resetState() {
        setActiveDragData(null);
        setHighlightedSectionId(null);
        document.body.style.setProperty('cursor', '');
    }

    /** Build order updates and parent changes from a categories array (use computed state, not ref). */
    function buildOrderAndParentUpdates(cats: FolderWithChildren[]): {
        orderUpdates: Array<{ id: string; sort_order: number }>;
        parentChanges: Array<{ id: string; parent_id: string }>;
    } {
        const orderUpdates: Array<{ id: string; sort_order: number }> = [];
        const parentChanges: Array<{ id: string; parent_id: string }> = [];

        for (const [catIndex, cat] of cats.entries()) {
            orderUpdates.push({ id: cat.id, sort_order: catIndex });

            for (const [secIndex, sec] of cat.children.entries()) {
                orderUpdates.push({ id: sec.id, sort_order: secIndex });

                if (sec.parent_id !== cat.id) parentChanges.push({ id: sec.id, parent_id: cat.id });
            }
        }

        return { orderUpdates, parentChanges };
    }

    function persistOrderFrom(categories: FolderWithChildren[]) {
        if (!onSectionsChange) return;

        const { orderUpdates, parentChanges } = buildOrderAndParentUpdates(categories);
        onSectionsChange(orderUpdates, parentChanges.length > 0 ? parentChanges : undefined);
    }

    // Register handlers on the shared ref for Layout's DndContext
    useEffect(() => {
        if (!treeDndHandlersRef) return;

        treeDndHandlersRef.current = {
            handleDragStart,
            handleDragOver,
            handleDragMove: () => {}, // No-op: we don't need move tracking
            handleDragEnd,
            handleDragCancel,
            resetState,
        };

        return () => {
            treeDndHandlersRef.current = null;
        };
    });

    return (
        <>
            <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
                <div className="flex shrink-0 flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Collections</p>
                        <div role="search" className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80" aria-hidden />
                            <Input
                                type="text"
                                inputMode="search"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                value={treeFilter}
                                onChange={(e) => setTreeFilter(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setTreeFilter('');
                                    }
                                }}
                                placeholder="Filter your collections"
                                aria-label="Filter collections and folders"
                                className={cn(
                                    'h-8 rounded-lg border-sidebar-border/80 bg-sidebar-accent/30 pl-9 text-sm shadow-none transition-colors',
                                    'placeholder:text-muted-foreground/70',
                                    'focus-visible:bg-sidebar-accent/50 focus-visible:border-sidebar-border',
                                    filterTrimmed.length > 0 && 'pr-9',
                                )}
                            />
                            <AnimatePresence>
                                {filterTrimmed.length > 0 && (
                                    <motion.div
                                        key="clear"
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.9 }}
                                        transition={{ duration: 0.15 }}
                                        className="absolute right-1 top-1/2 -translate-y-1/2"
                                    >
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            className="size-7 text-muted-foreground hover:text-foreground"
                                            aria-label="Clear filter"
                                            onClick={() => setTreeFilter('')}
                                        >
                                            <X className="size-3.5" />
                                        </Button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    <AnimatePresence initial={false}>
                        {filterActive && filteredCategories.length === 0 && (
                            <motion.p
                                key="empty"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                                className="overflow-hidden px-0.5 text-xs text-muted-foreground"
                            >
                                No matching collections or folders
                            </motion.p>
                        )}
                    </AnimatePresence>

                    <div className="space-y-1">
                        {filteredCategories.map((category) => {
                            const isCollapsed = filterActive ? false : (collapsed[category.id] ?? false);

                            return (
                                <CategoryItem
                                    key={category.id}
                                    category={category}
                                    collapsed={isCollapsed}
                                    disableDrag={filterActive}
                                    onToggleCollapse={() => toggleCollapse(category.id)}
                                    onRename={onEditCategory}
                                    onDelete={onDeleteCategory}
                                    onAddSection={onAddSection}
                                >
                                    <SortableContext items={category.children.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                                        {category.children.map((section) => (
                                            <SectionItem
                                                key={section.id}
                                                section={section}
                                                {...(currentSectionId !== undefined && { currentSectionId })}
                                                isHighlighted={highlightedSectionId === section.id}
                                                disableDrag={filterActive}
                                                onEditSection={onEditSection}
                                                onDeleteSection={onDeleteSection}
                                                onClose={onClose}
                                            />
                                        ))}
                                        {category.children.length === 0 && !isCollapsed && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="h-auto w-full opacity-50 justify-start gap-2 px-6 py-1.5 ml-3 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                                onClick={() => onAddSection?.(category)}
                                            >
                                                <Plus className="size-4 shrink-0" />
                                                Add folder
                                            </Button>
                                        )}
                                    </SortableContext>
                                </CategoryItem>
                            );
                        })}
                    </div>

                    {onAddCollection && (
                        <Button
                            type="button"
                            variant="ghost"
                            className="w-full justify-start gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                            onClick={onAddCollection}
                        >
                            <span className="text-base">+</span>
                            New collection
                        </Button>
                    )}
                </div>
            </SortableContext>

            {createPortal(
                <DragOverlay dropAnimation={dropAnimationConfig} modifiers={[snapCenterToCursor]}>
                    {activeDragData?.type === 'documents' ? (
                        <div className="rounded-md border border-primary/50 bg-primary/15 px-3 py-2 text-sm font-medium text-primary shadow-md">
                            {activeDragData.documentIds.length === 1 ? '1 document' : `${activeDragData.documentIds.length} documents`}
                        </div>
                    ) : activeDragData?.type === 'collection' ? (
                        <div className="rounded-md bg-sidebar-accent px-2 py-1.5 shadow-lg">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{activeDragData.category.name}</span>
                        </div>
                    ) : activeDragData?.type === 'folder' ? (
                        <div className="flex opacity-30 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 shadow-lg">
                            <SectionIcon value={activeDragData.section.emoji} />
                            <Link
                                to="/browse/$sectionId"
                                params={{ sectionId: activeDragData.section.id }}
                                className="min-w-0 truncate text-sm font-medium"
                                draggable={false}
                            >
                                {activeDragData.section.name}
                            </Link>
                        </div>
                    ) : null}
                </DragOverlay>,
                document.body,
            )}

            <DuplicateOptionsDialog
                title="File exists in destination"
                open={moveDuplicateState !== null}
                duplicateFilenames={moveDuplicateState?.duplicateFilenames ?? []}
                action="move"
                onConfirm={(strategy) => {
                    if (moveDuplicateState) {
                        doMove(moveDuplicateState.documentIds, moveDuplicateState.folderId, strategy);
                        setMoveDuplicateState(null);
                    }
                }}
                onCancel={() => setMoveDuplicateState(null)}
            />
        </>
    );
}

// ---- Helpers ----

function filterFolderTree(categories: FolderWithChildren[], filterTrimmed: string): FolderWithChildren[] {
    if (!filterTrimmed) return categories;

    const needle = filterTrimmed.toLowerCase();
    const result: FolderWithChildren[] = [];

    for (const cat of categories) {
        const catMatch = cat.name.toLowerCase().includes(needle);

        if (catMatch) {
            result.push(cat);

            continue;
        }

        const filteredChildren = cat.children.filter((sec) => sec.name.toLowerCase().includes(needle));

        if (filteredChildren.length > 0) {
            result.push({ ...cat, children: filteredChildren });
        }
    }

    return result;
}

function getDocumentFilenamesFromCache(queryClient: ReturnType<typeof useQueryClient>, documentIds: string[]): string[] {
    const idToFilename = new Map<string, string>();
    const queries = queryClient.getQueriesData<{ items?: Document[]; pages?: { items: Document[] }[] }>({ queryKey: ['documents'] });

    for (const [, data] of queries) {
        if (!data) continue;

        const items: Document[] = 'pages' in data && Array.isArray(data.pages) ? data.pages.flatMap((p) => p.items ?? []) : (data.items ?? []);

        for (const doc of items) {
            if (!idToFilename.has(doc.id)) {
                idToFilename.set(doc.id, doc.original_filename);
            }
        }
    }

    return documentIds.map((id) => idToFilename.get(id) ?? '').filter(Boolean);
}

function getDocumentDropHighlightId(overId: string, overData: unknown): string | null {
    const isOverSection = overData && typeof overData === 'object' && 'type' in overData && overData.type === 'folder';

    if (isOverSection) return String(overId);

    return String(overId).startsWith(FOLDER_DROP_PREFIX) ? String(overId).slice(FOLDER_DROP_PREFIX.length) : null;
}

function findParentCategoryId(categories: FolderWithChildren[], sectionId: string): string | null {
    const cat = categories.find((c) => c.children.some((s) => s.id === sectionId));

    return cat?.id ?? null;
}

function moveSectionBetweenCategories(categories: FolderWithChildren[], sectionId: string, fromCategoryId: string, toCategoryId: string): FolderWithChildren[] {
    return produce(categories, (draft) => {
        const from = draft.find((c) => c.id === fromCategoryId);
        const to = draft.find((c) => c.id === toCategoryId);

        if (!from || !to) return;

        const idx = from.children.findIndex((s) => s.id === sectionId);

        if (idx === -1) return;

        const [moved] = from.children.splice(idx, 1);
        to.children.push(moved!);
    });
}

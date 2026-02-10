import type { SortableTreeHandlers } from '@/components/layout/Layout';
import { FOLDER_DROP_PREFIX, useMoveDocuments } from '@/lib/sections';
import { useSelectionOptional } from '@/lib/selection';
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { DragOverlay, defaultDropAnimation } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { CategoryItem, categoryIdToSortableId, sortableIdToCategoryId } from './CategoryItem';
import { SectionItem } from './SectionItem';

interface CategorizedSectionsProps {
    sections: FolderWithChildren[];
    currentSectionId?: string;
    onSectionsChange?: (updates: Array<{ id: string; sort_order: number }>, parentChanges?: Array<{ id: string; parent_id: string }>) => void;
    onEditSection?: (section: FolderWithChildren) => void;
    onEditCategory?: (category: FolderWithChildren) => void;
    onAddSection?: (category: FolderWithChildren) => void;
    onDeleteSection?: (section: FolderWithChildren) => void;
    onDeleteCategory?: (category: FolderWithChildren) => void;
    treeDndHandlersRef?: RefObject<SortableTreeHandlers | null>;
}

type ActiveDragData =
    | { type: 'category'; category: FolderWithChildren }
    | { type: 'section'; section: FolderWithChildren }
    | { type: 'documents'; documentIds: string[] }
    | null;

const dropAnimationConfig = {
    keyframes({
        transform,
    }: {
        transform: { initial: { x: number; y: number; scaleX: number; scaleY: number }; final: { x: number; y: number; scaleX: number; scaleY: number } };
    }) {
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
    easing: 'ease-out' as const,
    sideEffects({ active }: { active: { node: HTMLElement } }) {
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
    onDeleteSection,
    onDeleteCategory,
    treeDndHandlersRef,
}: CategorizedSectionsProps) {
    // Categories are root-level items (type=category), sections are their children
    const [categories, setCategories] = useState<FolderWithChildren[]>(() => sections);
    const categoriesRef = useRef(categories);
    categoriesRef.current = categories;
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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

    const moveDocuments = useMoveDocuments();
    const selection = useSelectionOptional();

    // Sortable IDs for categories (prefixed) and sections
    const categoryIds = useMemo(() => categories.map((c) => categoryIdToSortableId(c.id)), [categories]);

    const toggleCollapse = useCallback((categoryId: string) => {
        setCollapsed((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
    }, []);

    // ---- DnD Handlers ----

    function handleDragStart({ active }: DragStartEvent) {
        const data = active.data.current;

        if (data?.type === 'category') {
            setActiveDragData({ type: 'category', category: data.category });
        } else if (data?.type === 'section') {
            setActiveDragData({ type: 'section', section: data.section });
        } else if (data?.type === 'documents' && Array.isArray(data.documentIds)) {
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

        // Document drag → highlight section
        if (activeData?.type === 'documents') {
            // Check if hovering over a section (not a category)
            if (overData?.type === 'section') {
                setHighlightedSectionId(String(over.id));
            } else {
                // Check if over.id matches a section via FOLDER_DROP_PREFIX
                const folderId = String(over.id).startsWith(FOLDER_DROP_PREFIX) ? String(over.id).slice(FOLDER_DROP_PREFIX.length) : null;

                if (folderId) {
                    setHighlightedSectionId(folderId);
                } else {
                    setHighlightedSectionId(null);
                }
            }

            return;
        }

        // Section drag → move between categories on hover
        if (activeData?.type === 'section' && overData) {
            const activeSectionId = String(active.id);
            let targetCategoryId: string | null = null;

            if (overData.type === 'category') {
                targetCategoryId = overData.category.id;
            } else if (overData.type === 'section') {
                // Find which category this section belongs to
                targetCategoryId = findParentCategoryId(categoriesRef.current, String(over.id));
            }

            if (targetCategoryId) {
                const sourceCategoryId = findParentCategoryId(categoriesRef.current, activeSectionId);

                if (sourceCategoryId && sourceCategoryId !== targetCategoryId) {
                    // Move section to new category
                    setCategories((prev) => moveSectionBetweenCategories(prev, activeSectionId, sourceCategoryId, targetCategoryId));
                }
            }
        }
    }

    function handleDragEnd({ active, over }: DragEndEvent) {
        const activeData = active.data.current;

        // Document drop → move to section
        if (activeData?.type === 'documents' && over) {
            const overData = over.data.current;
            let targetSectionId: string | null = null;

            if (overData?.type === 'section') {
                targetSectionId = String(over.id);
            }

            if (targetSectionId && activeData.documentIds.length > 0) {
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
            }

            resetState();

            return;
        }

        // Category reorder — compute new order and persist from that (ref is still stale here)
        if (activeData?.type === 'category' && over) {
            const overSortableId = String(over.id);
            const activeSortableId = String(active.id);

            if (activeSortableId !== overSortableId) {
                const activeCatId = sortableIdToCategoryId(activeSortableId);
                const overCatId = sortableIdToCategoryId(overSortableId);

                if (activeCatId && overCatId) {
                    const prev = categoriesRef.current;
                    const oldIndex = prev.findIndex((c) => c.id === activeCatId);
                    const newIndex = prev.findIndex((c) => c.id === overCatId);

                    if (oldIndex !== -1 && newIndex !== -1) {
                        const copy = [...prev];
                        const [moved] = copy.splice(oldIndex, 1);
                        copy.splice(newIndex, 0, moved!);
                        setCategories(copy);
                        persistOrderFrom(copy);
                    }
                }
            }

            resetState();

            return;
        }

        // Section reorder or cross-category move — persist from computed/current state
        if (activeData?.type === 'section' && over) {
            const activeSectionId = String(active.id);
            const overData = over.data.current;

            if (overData?.type === 'section' && activeSectionId !== String(over.id)) {
                const categoryId = findParentCategoryId(categoriesRef.current, activeSectionId);

                if (categoryId) {
                    const prev = categoriesRef.current;
                    const newCategories = prev.map((cat) => {
                        if (cat.id !== categoryId) return cat;

                        const children = [...cat.children];
                        const oldIndex = children.findIndex((s) => s.id === activeSectionId);
                        const newIndex = children.findIndex((s) => s.id === String(over.id));

                        if (oldIndex === -1 || newIndex === -1) return cat;

                        const [moved] = children.splice(oldIndex, 1);
                        children.splice(newIndex, 0, moved!);

                        return { ...cat, children };
                    });
                    setCategories(newCategories);
                    persistOrderFrom(newCategories);
                }
            } else {
                // Cross-category move already applied in handleDragOver; persist current state
                persistOrderFrom(categoriesRef.current);
            }

            resetState();

            return;
        }

        resetState();
    }

    function handleDragCancel() {
        resetState();
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
        cats.forEach((cat, catIndex) => {
            orderUpdates.push({ id: cat.id, sort_order: catIndex });
            cat.children.forEach((sec, secIndex) => {
                orderUpdates.push({ id: sec.id, sort_order: secIndex });

                if (sec.parent_id !== cat.id) {
                    parentChanges.push({ id: sec.id, parent_id: cat.id });
                }
            });
        });

        return { orderUpdates, parentChanges };
    }

    function persistOrderFrom(cats: FolderWithChildren[]) {
        if (!onSectionsChange) return;

        const { orderUpdates, parentChanges } = buildOrderAndParentUpdates(cats);
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
                <div className="space-y-1">
                    {categories.map((category) => (
                        <CategoryItem
                            key={category.id}
                            category={category}
                            collapsed={collapsed[category.id] ?? false}
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
                                        onEditSection={onEditSection}
                                        onDeleteSection={onDeleteSection}
                                    />
                                ))}
                                {category.children.length === 0 && !collapsed[category.id] && (
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-2 rounded-md px-6 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                        onClick={() => onAddSection?.(category)}
                                    >
                                        <Plus className="size-4 shrink-0" />
                                        Add section
                                    </button>
                                )}
                            </SortableContext>
                        </CategoryItem>
                    ))}
                </div>
            </SortableContext>

            {createPortal(
                <DragOverlay dropAnimation={dropAnimationConfig}>
                    {activeDragData?.type === 'documents' ? (
                        <div className="rounded-md border border-primary/50 bg-primary/15 px-3 py-2 text-sm font-medium text-primary shadow-md">
                            {activeDragData.documentIds.length === 1 ? '1 document' : `${activeDragData.documentIds.length} documents`}
                        </div>
                    ) : activeDragData?.type === 'category' ? (
                        <div className="rounded-md bg-sidebar-accent px-2 py-1.5 shadow-lg">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{activeDragData.category.name}</span>
                        </div>
                    ) : activeDragData?.type === 'section' ? (
                        <div className="flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 shadow-lg">
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
        </>
    );
}

// ---- Helpers ----

function findParentCategoryId(categories: FolderWithChildren[], sectionId: string): string | null {
    for (const cat of categories) {
        if (cat.children.some((s) => s.id === sectionId)) {
            return cat.id;
        }
    }

    return null;
}

function moveSectionBetweenCategories(categories: FolderWithChildren[], sectionId: string, fromCategoryId: string, toCategoryId: string): FolderWithChildren[] {
    // Two-pass: extract section first so order of categories in array doesn't matter (e.g. empty target before source)
    let movedSection: FolderWithChildren | null = null;
    const withoutSection = categories.map((cat) => {
        if (cat.id !== fromCategoryId) return cat;

        const child = cat.children.find((s) => s.id === sectionId);

        if (child) movedSection = child;

        const children = cat.children.filter((s) => s.id !== sectionId);

        return { ...cat, children };
    });

    if (!movedSection) return categories;

    return withoutSection.map((cat) => {
        if (cat.id !== toCategoryId) return cat;

        return { ...cat, children: [...cat.children, movedSection!] };
    });
}

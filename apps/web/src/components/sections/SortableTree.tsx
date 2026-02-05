import { FOLDER_DROP_PREFIX } from '@/lib/sections';
import { cn } from '@/lib/utils';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FolderWithChildren } from '@reverie/shared';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SortableSectionItem, type DropZone } from './SortableSectionItem';
import { flattenTree, removeChildrenOf, type ProjectionResult } from './tree-utils';

const INDENTATION_WIDTH = 20;

/** When dragging documents: which section is hovered and which zone (for drop indicators). */
export interface DocumentDropTarget {
    sectionId: string;
    dropZone: 'above' | 'center' | 'below';
}

/** Section drag: which boundary to show divider at (same gap = stable position from DOM measurement). */
export type DropIndicatorBoundary = { sectionId: string; dropZone: 'above' | 'below' } | null;

export interface SortableTreeProps {
    sections: FolderWithChildren[];
    currentSectionId: string | undefined;
    onAddSubSection: (parentId: string | null) => void;
    onEditSection: (section: FolderWithChildren) => void;
    onDeleteSection: (section: FolderWithChildren) => void;
    projected: ProjectionResult | null;
    activeId: string | null;
    documentDropTarget?: DocumentDropTarget | null;
    /** Section drag: which boundary to show divider at (tree measures DOM for stable Y) */
    dropIndicatorBoundary?: DropIndicatorBoundary;
    /** Scroll container so we re-measure on scroll */
    scrollContainerRef?: React.RefObject<HTMLElement | null>;
    /** Report viewport Y for the divider (from measured boundaries) */
    onDropIndicatorViewportY?: (y: number | null) => void;
}

export function SortableTree({
    sections,
    currentSectionId,
    projected,
    activeId,
    documentDropTarget = null,
    dropIndicatorBoundary = null,
    scrollContainerRef,
    onDropIndicatorViewportY,
}: SortableTreeProps) {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Flatten tree for sortable context
    const flattenedItems = useMemo(() => {
        const flattened = flattenTree(sections);

        // Get collapsed items
        const collapsedIds = flattened.filter(({ id, children }) => !expandedIds.has(id) && children.length > 0).map(({ id }) => id);

        // Remove children of collapsed items and the active item (if any)
        return removeChildrenOf(flattened, activeId ? [activeId, ...collapsedIds] : collapsedIds);
    }, [sections, expandedIds, activeId]);

    const sortedIds = useMemo(() => flattenedItems.map(({ id }) => id), [flattenedItems]);

    const listRef = useRef<HTMLDivElement>(null);

    // Compute stable divider Y from DOM boundaries (one position per gap, no flicker between sections)
    useLayoutEffect(() => {
        if (!dropIndicatorBoundary || !onDropIndicatorViewportY) {
            onDropIndicatorViewportY?.(null);
            return;
        }
        const { sectionId, dropZone } = dropIndicatorBoundary;
        const overIndex = flattenedItems.findIndex((item) => item.id === sectionId);
        if (overIndex === -1) {
            onDropIndicatorViewportY(null);
            return;
        }
        const boundaryIndex = dropZone === 'above' ? overIndex : overIndex + 1;

        const measure = () => {
            const list = listRef.current;
            if (!list) return;
            const children = Array.from(list.children) as HTMLElement[];
            if (children.length === 0) {
                onDropIndicatorViewportY(null);
                return;
            }
            if (boundaryIndex < 0 || boundaryIndex > children.length) {
                onDropIndicatorViewportY(null);
                return;
            }
            let viewportY: number;
            if (boundaryIndex === 0) {
                viewportY = children[0]!.getBoundingClientRect().top;
            } else if (boundaryIndex === children.length) {
                viewportY = children[children.length - 1]!.getBoundingClientRect().bottom;
            } else {
                const prev = children[boundaryIndex - 1]!.getBoundingClientRect();
                const next = children[boundaryIndex]!.getBoundingClientRect();
                viewportY = (prev.bottom + next.top) / 2;
            }
            onDropIndicatorViewportY(viewportY);
        };

        measure();
        const scrollEl = scrollContainerRef?.current;
        if (scrollEl) {
            scrollEl.addEventListener('scroll', measure);
            return () => {
                scrollEl.removeEventListener('scroll', measure);
                onDropIndicatorViewportY(null);
            };
        }
        return () => onDropIndicatorViewportY(null);
    }, [dropIndicatorBoundary, flattenedItems, onDropIndicatorViewportY, scrollContainerRef]);

    const toggleExpanded = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
            <div ref={listRef} className="space-y-0.5">
                {flattenedItems.map(({ id, depth }) => {
                    const section = findSection(sections, id);
                    if (!section) return null;

                    const isBeingDragged = id === activeId;

                    // Determine drop zone: section drag uses projected; document drag uses documentDropTarget
                    let dropZone: DropZone | undefined;
                    if (documentDropTarget?.sectionId === id) {
                        dropZone = documentDropTarget.dropZone;
                    } else if (projected && projected.targetId === id && !isBeingDragged) {
                        dropZone = projected.dropZone;
                    }

                    return (
                        <SectionItemWithDropzone
                            key={id}
                            id={id}
                            section={section}
                            depth={depth}
                            isExpanded={expandedIds.has(id)}
                            onToggleExpand={() => toggleExpanded(id)}
                            currentSectionId={currentSectionId}
                            isBeingDragged={isBeingDragged}
                            dropZone={dropZone}
                        />
                    );
                })}
            </div>
        </SortableContext>
    );
}

interface SectionItemWithDropzoneProps {
    id: string;
    section: FolderWithChildren;
    depth: number;
    isExpanded: boolean;
    onToggleExpand: () => void;
    currentSectionId: string | undefined;
    isBeingDragged: boolean;
    dropZone?: DropZone | null | undefined;
}

/**
 * Wraps SortableSectionItem with a droppable zone for documents
 */
function SectionItemWithDropzone({ id, section, depth, isExpanded, onToggleExpand, currentSectionId, isBeingDragged, dropZone }: SectionItemWithDropzoneProps) {
    const { active } = useDndContext();
    const isDraggingDocuments = active?.data.current?.type === 'documents';

    const { setNodeRef, isOver } = useDroppable({
        id: `${FOLDER_DROP_PREFIX}${id}`,
        data: { type: 'section-drop', sectionId: id },
        disabled: !isDraggingDocuments,
    });

    return (
        <div ref={setNodeRef} className={cn('rounded-md transition-colors', isDraggingDocuments && isOver && 'bg-primary/15 ring-2 ring-primary ring-inset')}>
            <SortableSectionItem
                id={id}
                section={section}
                depth={depth}
                isExpanded={isExpanded}
                onToggleExpand={onToggleExpand}
                currentSectionId={currentSectionId}
                indentationWidth={INDENTATION_WIDTH}
                isBeingDragged={isBeingDragged}
                dropZone={dropZone}
            />
        </div>
    );
}

/**
 * Find a section by id in the tree
 */
function findSection(sections: FolderWithChildren[], id: string): FolderWithChildren | null {
    for (const section of sections) {
        if (section.id === id) return section;
        const found = findSection(section.children, id);
        if (found) return found;
    }
    return null;
}

// Re-export utilities for use in Layout
export { calculateFinalPosition, flattenTree, getChildCount, getDropZone, getProjection } from './tree-utils';
export type { FlattenedSection, ProjectionResult } from './tree-utils';

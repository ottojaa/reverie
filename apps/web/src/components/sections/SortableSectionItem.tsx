import { cn } from '@/lib/utils';
import type { AnimateLayoutChanges } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import React from 'react';

const INDENTATION_WIDTH = 20;

// Never animate layout changes - items stay in place, only indicator line moves
const animateLayoutChanges: AnimateLayoutChanges = () => false;

export type DropZone = 'above' | 'center' | 'below' | null;

export interface SortableSectionItemProps {
    id: string;
    section: FolderWithChildren;
    depth: number;
    isExpanded: boolean;
    onToggleExpand: () => void;
    currentSectionId: string | undefined;
    clone?: boolean;
    ghost?: boolean;
    childCount?: number;
    indentationWidth?: number;
    /** Which zone is being hovered - determines visual feedback */
    dropZone?: DropZone | null | undefined;
    /** Whether this is the item being dragged */
    isBeingDragged?: boolean;
}

export function SortableSectionItem({
    id,
    section,
    depth,
    isExpanded,
    onToggleExpand,
    currentSectionId,
    clone,
    ghost,
    childCount,
    indentationWidth = INDENTATION_WIDTH,
    dropZone,
    isBeingDragged,
}: SortableSectionItemProps) {
    const { attributes, isDragging, listeners, setDraggableNodeRef, setDroppableNodeRef } = useSortable({
        id,
        animateLayoutChanges,
    });

    // Don't apply transforms - items stay in place, only indicator shows
    const style: CSSProperties = {};

    return (
        <SectionItemContent
            ref={setDraggableNodeRef}
            wrapperRef={setDroppableNodeRef}
            section={section}
            depth={depth}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
            currentSectionId={currentSectionId}
            clone={Boolean(clone)}
            ghost={Boolean(isDragging || isBeingDragged || ghost)}
            childCount={childCount ?? 0}
            indentationWidth={indentationWidth}
            style={style}
            handleProps={{ ...attributes, ...listeners }}
            dropZone={dropZone ?? null}
        />
    );
}

interface SectionItemContentProps {
    section: FolderWithChildren;
    depth: number;
    isExpanded: boolean;
    onToggleExpand: () => void;
    currentSectionId: string | undefined;
    clone?: boolean;
    ghost?: boolean;
    childCount?: number;
    indentationWidth: number;
    style?: CSSProperties;
    handleProps?: Record<string, unknown>;
    wrapperRef?: (node: HTMLDivElement) => void;
    dropZone?: DropZone;
}

export const SectionItemContent = React.forwardRef<HTMLDivElement, SectionItemContentProps>(
    (
        { section, depth, isExpanded, onToggleExpand, currentSectionId, clone, ghost, childCount, indentationWidth, style, handleProps, wrapperRef, dropZone },
        ref,
    ) => {
        const hasChildren = section.children.length > 0;
        const isActive = currentSectionId === section.id;
        const showCenterHighlight = dropZone === 'center';

        return (
            <div
                ref={wrapperRef}
                style={{
                    ...style,
                    paddingLeft: clone ? depth * indentationWidth : undefined,
                }}
                className={cn('relative', clone && 'inline-flex rounded-md bg-sidebar-accent px-2 py-1 shadow-lg', ghost && !clone && 'opacity-30')}
            >
                <div
                    ref={ref}
                    className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-grab active:cursor-grabbing',
                        isActive && !showCenterHighlight && 'bg-sidebar-accent text-sidebar-primary',
                        !isActive && !showCenterHighlight && 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                        showCenterHighlight && 'bg-primary/20 text-primary',
                    )}
                    style={{
                        paddingLeft: clone ? 8 : depth * indentationWidth + 8,
                    }}
                    {...handleProps}
                >
                    <button
                        type="button"
                        className="flex shrink-0 items-center justify-center p-0.5"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleExpand();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                        {hasChildren ? isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" /> : <span className="size-4" />}
                    </button>
                    <span className="shrink-0 text-base leading-none" aria-hidden>
                        {section.emoji ?? '📁'}
                    </span>
                    {clone ? (
                        <span className="min-w-0 truncate font-medium">{section.name}</span>
                    ) : (
                        <Link
                            to="/browse/$sectionId"
                            params={{ sectionId: section.id }}
                            className="min-w-0 flex-1 truncate font-medium"
                            draggable={false}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {section.name}
                        </Link>
                    )}
                    {section.document_count > 0 && !clone && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{section.document_count}</span>}
                    {clone && childCount && childCount > 1 && (
                        <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                            {childCount}
                        </span>
                    )}
                </div>
            </div>
        );
    },
);

SectionItemContent.displayName = 'SectionItemContent';

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import React, { forwardRef, useRef } from 'react';

const PREFETCH_HOVER_MS = 80;

import { UniqueIdentifier } from '@dnd-kit/core';

export type DropZoneProp = 'above' | 'center' | 'below' | null;

export interface Props extends Omit<React.HTMLAttributes<HTMLLIElement>, 'id'> {
    childCount?: number;
    clone?: boolean;
    collapsed?: boolean;
    currentSectionId?: string | undefined;
    depth: number;
    disableInteraction?: boolean;
    disableSelection?: boolean;
    dropZone?: DropZoneProp | undefined;
    ghost?: boolean;
    handleProps?: Record<string, unknown>;
    indicator?: boolean;
    indentationWidth: number;
    isDropTarget?: boolean;
    isHighlighted?: boolean | undefined;
    section?: FolderWithChildren | undefined;
    value: UniqueIdentifier;
    onAddSubSection?(section: FolderWithChildren): void;
    onCollapse?(): void;
    onDeleteSection?(section: FolderWithChildren): void;
    onEditSection?(section: FolderWithChildren): void;
    onRemove?(): void;
    /** Called after hover for PREFETCH_HOVER_MS; use to prefetch section documents. */
    onSectionHover?(sectionId: string): void;
    wrapperRef?(node: HTMLLIElement): void;
}

const INDICATOR_HEIGHT = 8;
const indicatorLineClassName = 'min-h-[6px] border-primary bg-primary/30 relative ';

export const TreeItem = forwardRef<HTMLDivElement, Props>(
    (
        {
            childCount,
            clone,
            collapsed,
            currentSectionId,
            depth,
            disableSelection,
            disableInteraction,
            dropZone,
            ghost,
            handleProps,
            indentationWidth,
            indicator,
            isDropTarget,
            isHighlighted,
            onAddSubSection,
            onCollapse,
            onDeleteSection,
            onEditSection,
            onRemove,
            onSectionHover,
            section,
            style,
            value,
            wrapperRef,
            ...props
        },
        ref,
    ) => {
        const triggerRef = useRef<HTMLDivElement>(null);
        const prefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

        const handleSectionMouseEnter = () => {
            if (!section?.id || !onSectionHover) return;
            prefetchTimeoutRef.current = setTimeout(() => {
                prefetchTimeoutRef.current = null;
                onSectionHover(section.id);
            }, PREFETCH_HOVER_MS);
        };
        const handleSectionMouseLeave = () => {
            if (prefetchTimeoutRef.current) {
                clearTimeout(prefetchTimeoutRef.current);
                prefetchTimeoutRef.current = null;
            }
        };
        const showIndicatorAbove = indicator && dropZone === 'above';
        const showIndicatorBelow = indicator && dropZone === 'below';
        const showCenterHighlight = isHighlighted || dropZone === 'center';
        const hasChildren = section ? section.children.length > 0 : false;
        const isExpanded = !collapsed;
        const isActive = section && currentSectionId === section.id;

        const rowClassName = section
            ? cn(
                  'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-grab active:cursor-grabbing',
                  isActive && !showCenterHighlight && 'bg-sidebar-accent text-sidebar-primary',
                  !isActive && !showCenterHighlight && 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  clone && 'inline-flex rounded-md bg-sidebar-accent px-2 py-1 shadow-lg',
                  ghost && !clone && '*:shadow-none *:bg-transparent',
              )
            : cn(
                  'relative flex items-center rounded-md px-2 py-1.5 text-sm transition-colors cursor-grab active:cursor-grabbing',
                  'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  clone && 'pr-6 rounded-md bg-sidebar-accent shadow-lg',
                  ghost && !clone && '*:shadow-none *:bg-transparent',
              );

        const contentPaddingLeft = clone ? 8 : depth * indentationWidth + 8;
        const { onDrag: _onDrag, ...restProps } = props;
        const { onDrag: _handleDrag, ...restHandleProps } = (handleProps ?? {}) as Record<string, unknown> & { onDrag?: unknown };

        return (
            <li
                className={cn(
                    'list-none box-border -mb-px',
                    clone && 'inline-block pointer-events-none w-full opacity-50',
                    ghost && !clone && 'opacity-30',
                    disableSelection && 'select-none',
                    disableInteraction && 'pointer-events-none',
                )}
                ref={wrapperRef}
                style={{
                    paddingLeft: `${indentationWidth * depth}px`,
                }}
                {...restProps}
                {...restHandleProps}
            >
                <motion.div
                    className="overflow-hidden"
                    initial={false}
                    animate={{ height: showIndicatorAbove ? INDICATOR_HEIGHT : 0, opacity: showIndicatorAbove ? 1 : 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                    <div className={cn('-mb-px', indicatorLineClassName)} />
                </motion.div>
                {section && !clone ? (
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div ref={triggerRef} className="relative w-full outline-none">
                                <motion.div
                                    className="absolute inset-0 rounded-md bg-primary/20"
                                    initial={false}
                                    animate={{ opacity: showCenterHighlight ? 1 : 0 }}
                                    transition={{ duration: 0.15, ease: 'easeOut' }}
                                    aria-hidden
                                />
                                <div
                                    className={cn(rowClassName, showCenterHighlight && 'text-primary')}
                                    ref={ref}
                                    style={{ ...style, position: 'relative' }}
                                    {...handleProps}
                                    onMouseEnter={section ? handleSectionMouseEnter : undefined}
                                    onMouseLeave={section ? handleSectionMouseLeave : undefined}
                                >
                                    {section ? (
                                        <>
                                            <button
                                                type="button"
                                                className="flex shrink-0 items-center justify-center p-0.5"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    onCollapse?.();
                                                }}
                                                onPointerDown={(e) => e.stopPropagation()}
                                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                            >
                                                {hasChildren ? (
                                                    isExpanded ? (
                                                        <ChevronDown className="size-4" />
                                                    ) : (
                                                        <ChevronRight className="size-4" />
                                                    )
                                                ) : (
                                                    <span className="size-4" />
                                                )}
                                            </button>
                                            <span className="shrink-0 text-base leading-none" aria-hidden>
                                                {section.emoji ?? '📁'}
                                            </span>
                                            <Link
                                                to="/browse/$sectionId"
                                                params={{ sectionId: section.id }}
                                                className="min-w-0 flex-1 truncate font-medium"
                                                draggable={false}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {section.name}
                                            </Link>
                                            {section.document_count > 0 && (
                                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{section.document_count}</span>
                                            )}
                                            <button
                                                type="button"
                                                className="ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent"
                                                aria-label="Section actions"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    triggerRef.current?.dispatchEvent(
                                                        new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }),
                                                    );
                                                }}
                                                onPointerDown={(e) => e.stopPropagation()}
                                            >
                                                <MoreHorizontal className="size-4" />
                                            </button>
                                        </>
                                    ) : null}
                                </div>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuItem onSelect={() => section && onEditSection?.(section)}>
                                <Pencil className="size-4" />
                                Edit
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => section && onAddSubSection?.(section)}>
                                <FolderPlus className="size-4" />
                                Add subsection
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem variant="destructive" onSelect={() => section && onDeleteSection?.(section)}>
                                <Trash2 className="size-4" />
                                Delete
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                ) : (
                    <div className="relative">
                        <motion.div
                            className="absolute inset-0 rounded-md bg-primary/20"
                            initial={false}
                            animate={{ opacity: showCenterHighlight ? 1 : 0 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            aria-hidden
                        />
                        <div
                            className={cn(rowClassName, showCenterHighlight && 'text-primary')}
                            ref={ref}
                            style={{ ...style, paddingLeft: contentPaddingLeft, position: 'relative' }}
                            {...handleProps}
                            onMouseEnter={section ? handleSectionMouseEnter : undefined}
                            onMouseLeave={section ? handleSectionMouseLeave : undefined}
                        >
                            {section ? (
                                <>
                                    <button
                                        type="button"
                                        className="flex shrink-0 items-center justify-center p-0.5"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onCollapse?.();
                                        }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                    >
                                        {hasChildren ? (
                                            isExpanded ? (
                                                <ChevronDown className="size-4" />
                                            ) : (
                                                <ChevronRight className="size-4" />
                                            )
                                        ) : (
                                            <span className="size-4" />
                                        )}
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
                                    {section.document_count > 0 && !clone && (
                                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{section.document_count}</span>
                                    )}
                                    {clone && childCount && childCount > 1 && (
                                        <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                                            {childCount}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <>
                                    <span
                                        className={cn('flex-1 whitespace-nowrap text-ellipsis overflow-hidden', (clone || disableSelection) && 'select-none')}
                                    >
                                        {value}
                                    </span>
                                    {clone && childCount && childCount > 1 ? (
                                        <span
                                            className={cn(
                                                'absolute -top-2.5 -right-2.5 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-sm font-semibold text-primary-foreground',
                                                (clone || disableSelection) && 'select-none',
                                            )}
                                        >
                                            {childCount}
                                        </span>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </div>
                )}
                <motion.div
                    className="overflow-hidden"
                    initial={false}
                    animate={{ height: showIndicatorBelow ? INDICATOR_HEIGHT : 0, opacity: showIndicatorBelow ? 1 : 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                    <div className={cn('-mt-px', indicatorLineClassName)} />
                </motion.div>
            </li>
        );
    },
);

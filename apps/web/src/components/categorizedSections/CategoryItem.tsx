import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FolderWithChildren } from '@reverie/shared';
import { ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';

/** Prefix category IDs to disambiguate from section IDs in collision detection */
export function categoryIdToSortableId(categoryId: string): string {
    return `category-${categoryId}`;
}

export function sortableIdToCategoryId(sortableId: string): string | null {
    return sortableId.startsWith('category-') ? sortableId.slice('category-'.length) : null;
}

interface CategoryItemProps {
    category: FolderWithChildren;
    collapsed: boolean;
    onToggleCollapse: () => void;
    onRename?: ((category: FolderWithChildren) => void) | undefined;
    onDelete?: ((category: FolderWithChildren) => void) | undefined;
    onAddSection?: ((category: FolderWithChildren) => void) | undefined;
    children: ReactNode;
}

export function CategoryItem({ category, collapsed, onToggleCollapse, onRename, onDelete, onAddSection, children }: CategoryItemProps) {
    const triggerRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const sortableId = categoryIdToSortableId(category.id);

    const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
        id: sortableId,
        data: { type: 'category' as const, category },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const rowContent = (
        <div
            ref={triggerRef}
            className={cn(
                'group flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors touch-none',
                'cursor-grab select-none active:cursor-grabbing',
                'hover:bg-sidebar-accent/50',
            )}
            {...attributes}
            {...listeners}
        >
            {/* Collapse chevron */}
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleCollapse();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={collapsed ? 'Expand' : 'Collapse'}
            >
                <motion.div initial={false} animate={{ rotate: collapsed ? -90 : 0 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}>
                    <ChevronDown className="size-3.5" />
                </motion.div>
            </Button>

            {/* Category name - uppercase label style */}
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{category.name}</span>

            {/* Add section */}
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(
                    'h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    !isMobile && 'opacity-0 transition-opacity group-hover:opacity-100',
                )}
                aria-label="Add section"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onAddSection?.(category);
                }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <Plus className="size-3.5" />
            </Button>
            {/* Actions button */}
            {isMobile ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-auto w-auto shrink-0 rounded p-0.5 hover:bg-sidebar-accent"
                            aria-label="Category actions"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="size-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onRename?.(category)}>
                            <Pencil className="size-4" />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.(category)}>
                            <Trash2 className="size-4" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-auto w-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent"
                    aria-label="Category actions"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerRef.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <MoreHorizontal className="size-3.5" />
                </Button>
            )}
        </div>
    );

    return (
        <div ref={setNodeRef} style={style} className={cn('rounded-md', isDragging && 'opacity-60')}>
            {isMobile ? (
                rowContent
            ) : (
                <ContextMenu>
                    <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onRename?.(category)}>
                            <Pencil className="size-4" />
                            Rename
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onSelect={() => onDelete?.(category)}>
                            <Trash2 className="size-4" />
                            Delete
                        </ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            )}

            {/* Collapsible children area */}
            <AnimatePresence initial={false}>
                {!collapsed && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="space-y-px pb-0.5">{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

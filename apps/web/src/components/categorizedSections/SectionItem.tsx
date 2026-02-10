import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { cn } from '@/lib/utils';
import type { AnimateLayoutChanges } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';

interface SectionItemProps {
    section: FolderWithChildren;
    currentSectionId?: string;
    isHighlighted?: boolean;
    onEditSection?: ((section: FolderWithChildren) => void) | undefined;
    onDeleteSection?: ((section: FolderWithChildren) => void) | undefined;
}

const animateLayoutChanges: AnimateLayoutChanges = ({ isSorting, wasDragging }) =>
    !(isSorting || wasDragging);

export function SectionItem({ section, currentSectionId, isHighlighted, onEditSection, onDeleteSection }: SectionItemProps) {
    const triggerRef = useRef<HTMLDivElement>(null);

    const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
        id: section.id,
        data: { type: 'section' as const, section },
        animateLayoutChanges,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const isActive = currentSectionId === section.id;

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    ref={(node) => {
                        setNodeRef(node);
                        (triggerRef as React.RefObject<HTMLDivElement | null>).current = node;
                    }}
                    style={style}
                    className={cn(
                        'group relative flex items-center gap-2 rounded-md px-2 py-1.5 pl-6 text-sm transition-colors',
                        'cursor-grab active:cursor-grabbing',
                        isDragging && 'z-10 opacity-50',
                        isActive && !isHighlighted && 'bg-sidebar-accent text-sidebar-primary',
                        !isActive && !isHighlighted && 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                        isHighlighted && 'bg-primary/15 text-primary',
                    )}
                    {...attributes}
                    {...listeners}
                >
                    <SectionIcon value={section.emoji} />
                    <Link
                        to="/browse/$sectionId"
                        params={{ sectionId: section.id }}
                        className="min-w-0 flex-1 truncate font-medium"
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {section.name}
                    </Link>
                    {section.document_count > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{section.document_count}</span>}
                    <button
                        type="button"
                        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent"
                        aria-label="Section actions"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            triggerRef.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <MoreHorizontal className="size-4" />
                    </button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onSelect={() => onEditSection?.(section)}>
                    <Pencil className="size-4" />
                    Edit
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => onDeleteSection?.(section)}>
                    <Trash2 className="size-4" />
                    Delete
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

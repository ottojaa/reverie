import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useVault } from '@/lib/vault';
import { cn } from '@/lib/utils';
import type { AnimateLayoutChanges } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { Lock, LockOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';

interface SectionItemProps {
    section: FolderWithChildren;
    currentSectionId?: string;
    isHighlighted?: boolean;
    onEditSection?: ((section: FolderWithChildren) => void) | undefined;
    onDeleteSection?: ((section: FolderWithChildren) => void) | undefined;
    onTogglePrivate?: ((section: FolderWithChildren, makePrivate: boolean) => void) | undefined;
    /** True when this folder is private only because its collection is (toggle disabled, shown as a badge). */
    inheritedPrivate?: boolean;
    onClose?: () => void;
    /** When true, folder row is not draggable (e.g. sidebar tree filter active). */
    disableDrag?: boolean;
}

const animateLayoutChanges: AnimateLayoutChanges = ({ isSorting, wasDragging }) => !(isSorting || wasDragging);

export function SectionItem({
    section,
    currentSectionId,
    isHighlighted,
    onEditSection,
    onDeleteSection,
    onTogglePrivate,
    inheritedPrivate = false,
    onClose,
    disableDrag = false,
}: SectionItemProps) {
    const triggerRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const { requestUnlock } = useVault();

    const ownPrivate = section.is_private;
    const isLocked = section.locked;

    // Removing privacy while locked would expose content without the password — unlock first.
    const handleTogglePrivate = () => {
        if (isLocked) {
            requestUnlock();

            return;
        }

        onTogglePrivate?.(section, !ownPrivate);
    };

    const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
        id: section.id,
        data: { type: 'folder' as const, section },
        animateLayoutChanges,
        disabled: disableDrag,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const isActive = currentSectionId === section.id;

    const rowContent = (
        <div
            ref={(node) => {
                setNodeRef(node);
                (triggerRef as React.RefObject<HTMLDivElement | null>).current = node;
            }}
            style={style}
            className={cn(
                'group relative flex items-center gap-2 rounded-md px-2 py-1.5 pl-6 text-sm transition-colors',
                !disableDrag && 'touch-pan-y cursor-grab select-none active:cursor-grabbing',
                disableDrag && 'cursor-default',
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
                onClick={(e) => {
                    e.stopPropagation();

                    // Locked folder: prompt to unlock instead of navigating into it.
                    if (isLocked) {
                        e.preventDefault();
                        requestUnlock();

                        return;
                    }

                    onClose?.();
                }}
            >
                {section.name}
            </Link>
            {isLocked ? (
                <button
                    type="button"
                    className="shrink-0 text-accent transition-transform hover:scale-110"
                    aria-label="Locked — click to unlock"
                    title="Locked — click to unlock"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        requestUnlock();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <Lock className="size-3" />
                </button>
            ) : (
                // Only a folder made private on its own shows a lock — inherited privacy is
                // conveyed by the parent collection's lock (the single lock unit). Unlocked →
                // an open padlock signals it's accessible this session.
                ownPrivate && <LockOpen className="size-3 shrink-0 text-accent" aria-label="Private (unlocked)" />
            )}
            {section.document_count > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{section.document_count}</span>}
            {isMobile ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-auto w-auto shrink-0 rounded p-0.5 hover:bg-sidebar-accent"
                            aria-label="Folder actions"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEditSection?.(section)}>
                            <Pencil className="size-4" />
                            Edit
                        </DropdownMenuItem>
                        {onTogglePrivate &&
                            (inheritedPrivate && !ownPrivate ? (
                                <DropdownMenuItem disabled>
                                    <Lock className="size-4" />
                                    Private (inherited)
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onSelect={handleTogglePrivate}>
                                    {ownPrivate ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                                    {ownPrivate ? 'Remove from private' : 'Make private'}
                                </DropdownMenuItem>
                            ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onDeleteSection?.(section)}>
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
                    aria-label="Folder actions"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerRef.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <MoreHorizontal className="size-4" />
                </Button>
            )}
        </div>
    );

    if (isMobile) {
        return rowContent;
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onSelect={() => onEditSection?.(section)}>
                    <Pencil className="size-4" />
                    Edit
                </ContextMenuItem>
                {onTogglePrivate &&
                    (inheritedPrivate && !ownPrivate ? (
                        <ContextMenuItem disabled>
                            <Lock className="size-4" />
                            Private (inherited)
                        </ContextMenuItem>
                    ) : (
                        <ContextMenuItem onSelect={handleTogglePrivate}>
                            {ownPrivate ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                            {ownPrivate ? 'Remove from private' : 'Make private'}
                        </ContextMenuItem>
                    ))}
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => onDeleteSection?.(section)}>
                    <Trash2 className="size-4" />
                    Delete
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

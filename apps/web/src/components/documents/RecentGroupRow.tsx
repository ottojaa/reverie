import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { formatAddedDate } from '@/lib/browse/format-added';
import { foldLabel, stackLabel, type RecentRow } from '@/lib/browse/recent-rows';
import { formatFileSize } from '@/lib/commonhelpers';
import { useConfirmedDelete } from '@/lib/hooks/useConfirmedDelete';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useSelectionOptional } from '@/lib/selection';
import { cn } from '@/lib/utils';
import { useDraggable } from '@dnd-kit/core';
import { ChevronRight, FolderInput, Trash2 } from 'lucide-react';
import { memo, useState, type MouseEvent } from 'react';

import { MoveToFolderDialog } from './DocumentCard/MoveToFolderDialog';
import { PileThumb } from './RowThumb';

type GroupRow = Extract<RecentRow, { type: 'group' }>;

interface RecentGroupRowProps {
    row: GroupRow;
    expanded: boolean;
    onToggle: (key: string) => void;
    /** Every loaded document in list order, for Shift-click ranges. */
    orderedIds: string[];
    columns: string;
    /** The folder's name for the Folder column, or undefined for no such column. */
    folderName: string | null | undefined;
    style: React.CSSProperties;
}

/**
 * A fold of media or a stack of same-name files, as one row. A click opens or closes it; Cmd/Ctrl-click and Shift-click
 * select its loaded members as a whole, and Move, Delete and drag act on them.
 */
export const RecentGroupRow = memo(function RecentGroupRow({ row, expanded, onToggle, orderedIds, columns, folderName, style }: RecentGroupRowProps) {
    const selection = useSelectionOptional();
    const isMobile = useIsMobile();
    const deleteWithConfirm = useConfirmedDelete();
    const [moveOpen, setMoveOpen] = useState(false);
    const memberIds = row.docs.map((doc) => doc.id);
    const newest = row.docs[0]!;
    const isSelected = selection != null && memberIds.every((id) => selection.isSelected(id));
    // Acting on a group that is part of a selection acts on the whole selection, as a right-click on a selected card does.
    const targetIds = isSelected && selection ? Array.from(selection.selectedIds) : memberIds;
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `group-${row.key}`,
        data: { type: 'documents' as const, documentIds: targetIds },
        disabled: isMobile,
    });
    const isFold = row.groupKind === 'fold';
    const title = isFold ? foldLabel(row.docs) : newest.original_filename;

    const handleClick = (e: MouseEvent) => {
        e.stopPropagation();

        if (!selection || !(e.metaKey || e.ctrlKey || e.shiftKey)) return onToggle(row.key);

        if (e.shiftKey) return extendSelection(selection);

        if (isSelected) return memberIds.forEach((id) => selection.deselect(id));

        selection.selectMany(memberIds);
    };

    /** Shift-click extends the range from the anchor through the group's far edge, so the whole group is in it. */
    function extendSelection(current: NonNullable<typeof selection>) {
        const anchor = current.anchorId;

        if (anchor == null) return current.selectAll(memberIds);

        const first = memberIds[0]!;
        const last = memberIds[memberIds.length - 1]!;
        const isAnchorBelow = orderedIds.indexOf(anchor) > orderedIds.indexOf(last);

        current.selectRange(anchor, isAnchorBelow ? first : last, orderedIds);
    }

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div
                        ref={setNodeRef}
                        data-document-card
                        className={cn('absolute left-0 right-0', isDragging && 'opacity-50')}
                        style={{ ...style, touchAction: isMobile ? 'pan-y' : 'none' }}
                        {...attributes}
                        role={undefined}
                        tabIndex={-1}
                        {...listeners}
                    >
                        <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={handleClick}
                            // The wrapper's drag listeners include the keyboard sensor, which would take Enter/Space for a drag start and cancel the click. Other keys (the Cmd+K and Cmd+Shift+O shortcuts) must still reach the document.
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                            }}
                            className={cn(
                                'grid h-full w-full items-center gap-4 border-t border-border/60 px-4 text-left text-sm transition-colors hover:bg-muted/50',
                                'focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                                isSelected && 'bg-primary/12 hover:bg-primary/15 dark:bg-primary/15',
                            )}
                            style={{ gridTemplateColumns: columns }}
                        >
                            <span className="flex min-w-0 items-center gap-3">
                                <ChevronRight
                                    className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
                                    aria-hidden
                                />
                                <PileThumb documents={row.docs} />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate font-medium" title={title}>
                                        {title}
                                    </span>
                                    {!isFold && <span className="truncate text-xs text-primary">{stackLabel(row.docs)}</span>}
                                </span>
                            </span>
                            {folderName !== undefined && <span className="truncate text-muted-foreground">{folderName ?? '—'}</span>}
                            <span className="text-right font-mono text-[13px] text-muted-foreground">{isFold ? '' : formatFileSize(newest.size_bytes)}</span>
                            <span className="truncate text-muted-foreground">{formatAddedDate(newest.created_at)}</span>
                        </button>
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onSelect={() => setMoveOpen(true)}>
                        <FolderInput className="size-4" />
                        Move to…
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onSelect={() => void deleteWithConfirm(targetIds)}>
                        <Trash2 className="size-4" />
                        Delete
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
            {moveOpen && <MoveToFolderDialog documentIds={targetIds} open={moveOpen} onOpenChange={setMoveOpen} />}
        </>
    );
});

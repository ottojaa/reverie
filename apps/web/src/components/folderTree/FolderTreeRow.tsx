import { FolderPadlock } from '@/components/folders/FolderPadlock';
import { Button } from '@/components/ui/button';
import { SectionIcon } from '@/components/ui/SectionIcon';
import type { FolderDrop } from '@/lib/folders/move.js';
import { toIndent, toTotalCount, type FolderRow } from '@/lib/folders/tree.js';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { useVault } from '@/lib/vault';
import { useDraggable } from '@dnd-kit/core';
import type { FolderWithChildren } from '@reverie/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { DropZone } from './DropZone';
import { FolderActionsDropdown, FolderActionsHoverButton, FolderContextMenu, type FolderRowActions } from './FolderRowMenu';

/** What is being dragged, as far as this row's drop zones care. */
export type RowDragKind = 'folder' | 'documents' | null;

export interface FolderTreeRowProps extends FolderRow {
    isCurrent: boolean;
    isOpen: boolean;
    /** Left out while the tree is filtered: everything stays open. */
    onToggle: ((folder: FolderWithChildren) => void) | undefined;
    dragKind: RowDragKind;
    /** True for the dragged folder and everything inside it, which cannot be dropped on. */
    isDragSource: boolean;
    isDragDisabled: boolean;
    /** Where on this row the drag currently is. */
    dropZone: FolderDrop['zone'] | null;
    actions: FolderRowActions;
    onClose: (() => void) | undefined;
}

function FolderChevron({ folder, isOpen, onToggle }: Pick<FolderTreeRowProps, 'folder' | 'isOpen' | 'onToggle'>) {
    // A locked folder lists no subfolders, so it has nothing to expand.
    if (folder.locked || folder.children.length === 0) return <span className="size-[18px] shrink-0" aria-hidden />;

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-[18px] shrink-0 rounded p-0 text-muted-foreground hover:bg-transparent hover:text-sidebar-foreground dark:hover:bg-transparent"
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${folder.name}`}
            aria-expanded={isOpen}
            disabled={!onToggle}
            onClick={() => onToggle?.(folder)}
        >
            <ChevronRight className={cn('size-3.5 transition-transform duration-200', isOpen && 'rotate-90')} />
        </Button>
    );
}

function FolderRowDropZones({ folder, isOpen, dragKind, isDragSource }: FolderTreeRowProps) {
    const isFolderDrag = dragKind === 'folder' && !isDragSource;
    // Below an open folder's row comes its first subfolder, whose "before" already covers that spot.
    const hasAfter = !(isOpen && folder.children.length > 0);
    const target = { targetId: folder.id };

    // "Into" covers the whole row. Where "before" or "after" overlaps it, the smaller zone wins.
    return (
        <>
            <DropZone drop={{ zone: 'into', ...target }} disabled={!isFolderDrag && dragKind !== 'documents'} className="inset-y-0" />
            <DropZone drop={{ zone: 'before', ...target }} disabled={!isFolderDrag} className="top-0 h-1/4" />
            <DropZone drop={{ zone: 'after', ...target }} disabled={!isFolderDrag || !hasAfter} className="bottom-0 h-1/4" />
        </>
    );
}

/** Opening a locked folder's lock, then going in. */
function useUnlockAndOpen(folder: FolderWithChildren, onClose: (() => void) | undefined) {
    const { requestUnlock } = useVault();
    const navigate = useNavigate();

    return async () => {
        if (!(await requestUnlock(folder.id))) return;

        onClose?.();
        void navigate({ to: '/browse/$sectionId', params: { sectionId: folder.id } });
    };
}

function FolderLink({ folder, isCurrent, onClose, onUnlock }: Pick<FolderTreeRowProps, 'folder' | 'isCurrent' | 'onClose'> & { onUnlock: () => void }) {
    return (
        <Link
            to="/browse/$sectionId"
            params={{ sectionId: folder.id }}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 font-medium"
            draggable={false}
            aria-current={isCurrent ? 'page' : undefined}
            title={folder.name}
            onClick={(e) => {
                // A locked folder asks to be unlocked instead of opening.
                if (folder.locked) {
                    e.preventDefault();
                    onUnlock();

                    return;
                }

                onClose?.();
            }}
        >
            <SectionIcon value={folder.emoji || 'folder'} />
            <span className="truncate">{folder.name}</span>
        </Link>
    );
}

/** The row itself. The context menu around it passes its own handlers and ref in as div props. */
function RowShell({ row, ref: menuRef, style, ...divProps }: ComponentProps<'div'> & { row: FolderTreeRowProps }) {
    const { folder, depth, isCurrent, isDragSource, isDragDisabled, dropZone, actions, onClose } = row;
    const isMobile = useIsMobile();
    const unlockAndOpen = useUnlockAndOpen(folder, onClose);
    // No dnd-kit attributes, and the row as its own activator: Enter on the link or a button stays theirs.
    const { listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
        id: `folder:${folder.id}`,
        data: { type: 'folder', folderId: folder.id },
        disabled: isDragDisabled,
    });
    const count = toTotalCount(folder);

    return (
        <div
            {...divProps}
            {...listeners}
            ref={(node) => {
                setNodeRef(node);
                setActivatorNodeRef(node);

                if (typeof menuRef === 'function') menuRef(node);
                else if (menuRef) menuRef.current = node;
            }}
            style={{ ...style, paddingLeft: toIndent(depth) - 2 }}
            className={cn(
                'group relative flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg pr-2.5 text-sm transition-colors',
                !isDragDisabled && 'cursor-grab touch-pan-y select-none active:cursor-grabbing',
                isCurrent ? 'bg-sidebar-accent text-sidebar-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                isDragSource && 'opacity-50',
                dropZone === 'into' && 'bg-primary/15 text-primary',
                dropZone === 'before' && 'before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:rounded-full before:bg-primary',
                dropZone === 'after' && 'after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary',
            )}
        >
            <FolderRowDropZones {...row} />
            <FolderChevron {...row} />
            <FolderLink {...row} onUnlock={() => void unlockAndOpen()} />
            <FolderPadlock folder={folder} onUnlock={() => void unlockAndOpen()} />
            {count > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>}
            {isMobile ? <FolderActionsDropdown folder={folder} actions={actions} /> : <FolderActionsHoverButton />}
        </div>
    );
}

export function FolderTreeRow(props: FolderTreeRowProps) {
    const isMobile = useIsMobile();

    if (isMobile) return <RowShell row={props} />;

    return (
        <FolderContextMenu folder={props.folder} actions={props.actions}>
            <RowShell row={props} />
        </FolderContextMenu>
    );
}

import type { TreeDragHandlers } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { findFolder, flattenTree, searchTree } from '@/lib/folders/tree.js';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import type { FolderWithChildren } from '@reverie/shared';
import { Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type RefObject } from 'react';
import { DragPreview } from './DragPreview';
import { DropZone } from './DropZone';
import { FolderFilterInput } from './FolderFilterInput';
import { FolderTreeRow, type FolderTreeRowProps } from './FolderTreeRow';
import { useFolderActions } from './useFolderActions';
import { useOpenFolders } from './useOpenFolders';
import { useTreeDrag } from './useTreeDrag';

const COLLAPSE_TRANSITION = { duration: 0.2, ease: [0.32, 0.72, 0, 1] } as const;
const COLLAPSED = { opacity: 0, height: 0 };
const EXPANDED = { opacity: 1, height: 'auto' };

interface FolderTreeProps {
    tree: FolderWithChildren[];
    currentId: string | undefined;
    dragHandlersRef: RefObject<TreeDragHandlers | null>;
    /** Asks for a new folder inside the given one, or at the top level (null). */
    onNewFolder: (parentId: string | null) => void;
    onClose?: (() => void) | undefined;
}

function FolderTreeHeader({ onNewFolder }: { onNewFolder: () => void }) {
    return (
        <div className="flex items-center justify-between pl-0.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Folders</h2>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent"
                aria-label="New folder"
                title="New folder"
                onClick={onNewFolder}
            >
                <Plus className="size-[18px]" />
            </Button>
        </div>
    );
}

/** A line that slides in under the filter when nothing matches it. */
function NoMatches({ isShown }: { isShown: boolean }) {
    return (
        <AnimatePresence initial={false}>
            {isShown && (
                <motion.p
                    key="empty"
                    initial={COLLAPSED}
                    animate={EXPANDED}
                    exit={COLLAPSED}
                    transition={COLLAPSE_TRANSITION}
                    className="overflow-hidden px-0.5 text-xs text-muted-foreground"
                >
                    No matching folders
                </motion.p>
            )}
        </AnimatePresence>
    );
}

function NewFolderButton({ onClick }: { onClick: () => void }) {
    return (
        <Button
            type="button"
            variant="ghost"
            className="w-full justify-start gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent"
            onClick={onClick}
        >
            <Plus className="size-4" />
            New folder
        </Button>
    );
}

/** Where a nested folder is dropped to move it out to the top level. */
function TopLevelDrop({ isOver }: { isOver: boolean }) {
    return (
        <div
            className={cn(
                'relative flex h-[34px] items-center justify-center rounded-lg border border-dashed border-sidebar-border text-xs text-muted-foreground',
                isOver && 'border-primary bg-primary/15 text-primary',
            )}
        >
            Move to top level
            <DropZone drop={{ zone: 'top' }} disabled={false} className="inset-y-0" />
        </div>
    );
}

/** The rows, each sliding open or shut as its parent expands or collapses. */
function FolderRows({ rows }: { rows: FolderTreeRowProps[] }) {
    return (
        <div className="flex flex-col">
            <AnimatePresence initial={false}>
                {rows.map((row) => (
                    <motion.div
                        key={row.folder.id}
                        initial={COLLAPSED}
                        animate={EXPANDED}
                        exit={COLLAPSED}
                        transition={COLLAPSE_TRANSITION}
                        className="overflow-hidden"
                    >
                        <div className="pb-0.5">
                            <FolderTreeRow {...row} />
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}

/** The sidebar's folders, to any depth. */
export function FolderTree({ tree, currentId, dragHandlersRef, onNewFolder, onClose }: FolderTreeProps) {
    const isMobile = useIsMobile();
    const [query, setQuery] = useState('');
    const isFiltering = query.trim().length > 0;
    const { openIds, open, toggle } = useOpenFolders(tree, currentId);
    const drag = useTreeDrag(tree, dragHandlersRef, (folderId) => open([folderId]));
    const actions = useFolderActions((parentId) => {
        open([parentId]);
        onNewFolder(parentId);
    });
    const dragged = findFolder(tree, drag.active?.type === 'folder' ? drag.active.folderId : null);
    const draggedIds = new Set(flattenTree(dragged ? [dragged] : []).map((row) => row.folder.id));
    const visible = isFiltering ? searchTree(tree, query) : flattenTree(tree, (folder) => openIds.has(folder.id));
    const rows = visible.map(({ folder, depth }) => ({
        folder,
        depth,
        isCurrent: folder.id === currentId,
        // A filtered tree is all open and stays that way.
        isOpen: isFiltering || openIds.has(folder.id),
        onToggle: isFiltering ? undefined : toggle,
        dragKind: drag.active?.type ?? null,
        isDragSource: draggedIds.has(folder.id),
        isDragDisabled: isFiltering || isMobile,
        dropZone: drag.over && drag.over.zone !== 'top' && drag.over.targetId === folder.id ? drag.over.zone : null,
        actions,
        onClose,
    }));

    return (
        <div className="flex shrink-0 flex-col gap-1.5">
            <FolderTreeHeader onNewFolder={() => onNewFolder(null)} />
            <FolderFilterInput value={query} onChange={setQuery} />
            <NoMatches isShown={isFiltering && rows.length === 0} />
            <FolderRows rows={rows} />
            {dragged?.parent_id && <TopLevelDrop isOver={drag.over?.zone === 'top'} />}
            {tree.length === 0 && <NewFolderButton onClick={() => onNewFolder(null)} />}
            <DragPreview drag={drag.active} tree={tree} />
            {drag.dialog}
        </div>
    );
}

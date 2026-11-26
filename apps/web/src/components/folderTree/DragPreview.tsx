import { SectionIcon } from '@/components/ui/SectionIcon';
import { findFolder } from '@/lib/folders/tree.js';
import { defaultDropAnimation, DragOverlay, type DropAnimation } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import type { FolderWithChildren } from '@reverie/shared';
import { createPortal } from 'react-dom';
import { snapBesidePointer } from './snapBesidePointer';
import type { TreeDrag } from './useTreeDrag';

/** The preview fades out just past where it was dropped, while the dragged element fades back in. */
const dropAnimationConfig: DropAnimation = {
    keyframes({ transform }) {
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
    easing: 'ease-out',
    sideEffects({ active }) {
        active.node.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: defaultDropAnimation.duration,
            easing: defaultDropAnimation.easing,
        });
    },
};

/** Without this the preview takes the size of the dragged row, and its label can end up far from the pointer. */
const FIT_CONTENT = { width: 'max-content', height: 'auto' };

function PreviewContent({ drag, tree }: { drag: TreeDrag; tree: FolderWithChildren[] }) {
    if (drag.type === 'documents') {
        return (
            <div className="rounded-md border border-primary/50 bg-popover px-3 py-2 text-sm font-medium text-primary shadow-md">
                {drag.documentIds.length === 1 ? '1 document' : `${drag.documentIds.length} documents`}
            </div>
        );
    }

    const folder = findFolder(tree, drag.folderId);

    if (!folder) return null;

    return (
        <div className="flex opacity-30 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 shadow-lg">
            <SectionIcon value={folder.emoji || 'folder'} />
            <span className="min-w-0 truncate text-sm font-medium">{folder.name}</span>
        </div>
    );
}

/** What follows the pointer during a drag. */
export function DragPreview({ drag, tree }: { drag: TreeDrag | null; tree: FolderWithChildren[] }) {
    const isDocuments = drag?.type === 'documents';

    return createPortal(
        <DragOverlay
            dropAnimation={dropAnimationConfig}
            modifiers={[isDocuments ? snapBesidePointer : snapCenterToCursor]}
            {...(isDocuments && { style: FIT_CONTENT })}
        >
            {drag && <PreviewContent drag={drag} tree={tree} />}
        </DragOverlay>,
        document.body,
    );
}

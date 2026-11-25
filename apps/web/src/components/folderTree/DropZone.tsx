import type { FolderDrop } from '@/lib/folders/move.js';
import { cn } from '@/lib/utils';
import { useDroppable } from '@dnd-kit/core';

function toDropId(drop: FolderDrop): string {
    return drop.zone === 'top' ? 'tree:top' : `tree:${drop.zone}:${drop.targetId}`;
}

/** An area of the tree that takes a drop. It never catches pointer events, so the row beneath stays clickable. */
export function DropZone({ drop, disabled, className }: { drop: FolderDrop; disabled: boolean; className: string }) {
    const { setNodeRef } = useDroppable({ id: toDropId(drop), data: { drop }, disabled });

    return <div ref={setNodeRef} className={cn('pointer-events-none absolute inset-x-0', className)} aria-hidden />;
}

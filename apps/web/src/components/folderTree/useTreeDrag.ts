import type { TreeDragHandlers } from '@/components/layout/Layout';
import { planMove, type FolderDrop } from '@/lib/folders/move.js';
import { findFolder } from '@/lib/folders/tree.js';
import { useReorderFolders, useUpdateFolder } from '@/lib/sections';
import type { DragEndEvent, DragOverEvent, DragStartEvent, Over } from '@dnd-kit/core';
import type { FolderWithChildren } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type RefObject } from 'react';
import { useDocumentDrop } from './useDocumentDrop';

/** What the sidebar can take: a folder row of its own, or documents dragged in from a list. */
export type TreeDrag = { type: 'folder'; folderId: string } | { type: 'documents'; documentIds: string[] };

/** Delay before clearing the overlay, so its drop animation can finish (default 250ms plus a buffer). */
const DROP_ANIMATION_DURATION_MS = 300;

function toTreeDrag(data: Record<string, unknown> | undefined): TreeDrag | null {
    return data?.type === 'folder' || data?.type === 'documents' ? (data as TreeDrag) : null;
}

function toFolderDrop(over: Over | null): FolderDrop | null {
    return (over?.data.current?.drop as FolderDrop | undefined) ?? null;
}

function useFolderDrop(tree: FolderWithChildren[], onMovedInto: (folderId: string) => void) {
    const queryClient = useQueryClient();
    const updateFolder = useUpdateFolder();
    const reorderFolders = useReorderFolders();

    return async function drop(folderId: string, target: FolderDrop) {
        const move = planMove(tree, folderId, target);

        if (!move) return;

        const { parentId, order } = move;

        if (parentId !== undefined) {
            // The new parent has to be saved before positions among its subfolders mean anything.
            const isMoved = await updateFolder.mutateAsync({ id: folderId, data: { parent_id: parentId } }).then(
                () => true,
                () => false, // the mutation has already rolled back and said why
            );

            if (!isMoved) return;

            if (parentId) onMovedInto(parentId);
        }

        if (!order) return;

        // Reordering cancels the refetch the move started, so ask for the moved folder's new counts and locks again.
        reorderFolders.mutate(order, {
            onSuccess: () => {
                if (parentId !== undefined) void queryClient.invalidateQueries({ queryKey: ['sections'] });
            },
        });
    };
}

/** Handles the drags the layout's drag context reports to the sidebar, for as long as the tree is mounted. */
export function useTreeDrag(tree: FolderWithChildren[], handlersRef: RefObject<TreeDragHandlers | null>, onMovedInto: (folderId: string) => void) {
    const [active, setActive] = useState<TreeDrag | null>(null);
    const [over, setOver] = useState<FolderDrop | null>(null);
    const dropFolder = useFolderDrop(tree, onMovedInto);
    const documentDrop = useDocumentDrop();

    function reset() {
        setActive(null);
        setOver(null);
        document.body.style.removeProperty('cursor');
    }

    function handleDragStart({ active }: DragStartEvent) {
        setActive(toTreeDrag(active.data.current));
        document.body.style.setProperty('cursor', 'grabbing');
    }

    function handleDragEnd(event: DragEndEvent) {
        const dragged = toTreeDrag(event.active.data.current);
        const target = toFolderDrop(event.over);
        setTimeout(reset, DROP_ANIMATION_DURATION_MS);
        setOver(null);

        if (!dragged || !target) return;

        if (dragged.type === 'folder') return void dropFolder(dragged.folderId, target);

        const folder = target.zone === 'into' ? findFolder(tree, target.targetId) : null;

        if (folder) void documentDrop.drop(dragged.documentIds, folder);
    }

    useEffect(() => {
        handlersRef.current = {
            handleDragStart,
            handleDragOver: ({ over }: DragOverEvent) => setOver(toFolderDrop(over)),
            handleDragEnd,
            handleDragCancel: () => setTimeout(reset, DROP_ANIMATION_DURATION_MS),
        };

        return () => {
            handlersRef.current = null;
        };
    });

    return { active, over, dialog: documentDrop.dialog };
}

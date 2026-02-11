import { useDeleteDocuments } from '@/lib/api/documents';
import { useConfirm } from '@/lib/confirm';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useLongPress } from '@/lib/hooks/useLongPress';
import { useSelectionOptional } from '@/lib/selection';
import { useDraggable } from '@dnd-kit/core';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef } from 'react';

const DOUBLE_TAP_MS = 400;
const LONG_PRESS_MS = 450;

interface UseDocumentInteractionOptions {
    document: Document;
    orderedIds?: string[] | undefined;
}

/**
 * Encapsulates all interaction logic for a document card:
 * selection, navigation, drag, long-press, context-menu delete.
 */
export function useDocumentInteraction({ document, orderedIds = [] }: UseDocumentInteractionOptions) {
    const selection = useSelectionOptional();
    const confirm = useConfirm();
    const deleteDocuments = useDeleteDocuments();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const isMobile = useIsMobile();

    const lastTapRef = useRef<{ id: string; time: number } | null>(null);
    const longPressFiredRef = useRef(false);

    const isSelected = selection?.isSelected(document.id) ?? false;
    const selectedIds = selection?.selectedIds ?? new Set<string>();
    const inSelectionMode = selectedIds.size > 0;

    // --- Navigation ---

    const navigateToDocument = useCallback(() => {
        queryClient.setQueryData(['document', document.id], document);
        navigate({ to: '/document/$id', params: { id: document.id } });
    }, [queryClient, document, navigate]);

    /** Returns true if this tap was the second of a double-tap. */
    const isDoubleTap = useCallback(() => {
        const now = Date.now();
        const prev = lastTapRef.current;

        if (prev?.id === document.id && now - prev.time < DOUBLE_TAP_MS) {
            lastTapRef.current = null;

            return true;
        }

        lastTapRef.current = { id: document.id, time: now };

        return false;
    }, [document.id]);

    // --- Long press (mobile) ---

    const handleLongPress = useCallback(() => {
        longPressFiredRef.current = true;
        selection?.selectOnly(document.id);
    }, [document.id, selection]);

    const longPressHandlers = useLongPress(handleLongPress, {
        threshold: LONG_PRESS_MS,
        enabled: isMobile,
    });

    // --- Drag ---

    const documentIds = isSelected ? Array.from(selectedIds) : [document.id];

    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `doc-${document.id}`,
        data: { type: 'documents' as const, documentIds },
        disabled: isMobile,
    });

    // --- Click handler ---

    const handleClick = (e: React.MouseEvent) => {
        const handleMobileClick = () => {
            e.preventDefault();
            e.stopPropagation();

            if(longPressFiredRef.current) {
                longPressFiredRef.current = false;

                return;
            }

            if (inSelectionMode) {
                selection?.toggle(document.id);

                return;
            }

            if (isDoubleTap()) {
                navigateToDocument();
            }

            return;
        };

        const handleDesktopClick = () => {
            e.preventDefault();
            e.stopPropagation();

            if (e.shiftKey && selection) {
                const anchor = selection.anchorId;
    
                if (anchor != null && orderedIds.length > 0) {
                    selection.selectRange(anchor, document.id, orderedIds);
                } else {
                    selection.selectOnly(document.id);
                }
    
                return;
            }
    
            if ((e.metaKey || e.ctrlKey) && selection) {
                selection.toggle(document.id);
    
                return;
            }
    
            // Simple click: double-tap detection, then select
            if (isDoubleTap()) {
                e.stopPropagation();
                navigateToDocument();
    
                return;
            }
    
            selection?.selectOnly(document.id);

            return;
        };

        if (isMobile) {
            handleMobileClick();
        } else {
            handleDesktopClick();
        }

    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        navigateToDocument();
    };

    // --- Delete ---

    const handleDelete = async () => {
        const confirmed = await confirm({
            title: 'Delete document?',
            description: 'This action cannot be undone.',
            confirmText: 'Delete',
            variant: 'destructive',
        });

        if (confirmed) deleteDocuments.mutate([document.id]);
    };

    return {
        // State
        isSelected,
        isDragging,
        isMobile,
        // Handlers
        handleClick,
        handleDoubleClick,
        handleDelete,
        // Drag props (spread onto DOM element)
        dragRef: setNodeRef,
        dragAttributes: attributes,
        dragListeners: listeners,
        longPressHandlers,
    };
}

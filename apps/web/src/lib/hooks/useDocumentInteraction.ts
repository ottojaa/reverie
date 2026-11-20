import { useDeleteDocuments } from '@/lib/api/documents';
import { buildDownloadUrl, buildFileUrl } from '@/lib/commonhelpers';
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
        queryClient.invalidateQueries({ queryKey: ['document', document.id] });
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

            if (longPressFiredRef.current) {
                longPressFiredRef.current = false;

                return;
            }

            if (inSelectionMode) {
                selection?.toggle(document.id);

                return;
            }

            // Single tap navigates; long-press selects
            navigateToDocument();
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
        // A right-click on an unselected card targets just that card (same rule as move).
        const ids = documentIds;
        const count = ids.length;
        const confirmed = await confirm({
            title: count === 1 ? 'Move document to Trash?' : `Move ${count} documents to Trash?`,
            description:
                count === 1
                    ? 'The document moves to Trash. You can restore it there until it is purged.'
                    : 'The documents move to Trash. You can restore them there until they are purged.',
            confirmText: 'Move to Trash',
            cancelText: 'Cancel',
            variant: 'destructive',
        });

        if (!confirmed) return;

        deleteDocuments.mutate(ids, {
            onSuccess: () => selection?.clear(),
        });
    };

    // --- Download ---

    const handleDownload = () => {
        const fileUrl = buildFileUrl(document.file_url);

        if (!fileUrl) return;

        // Download flag on the signed URL → server responds with Content-Disposition: attachment
        const a = window.document.createElement('a');
        a.href = buildDownloadUrl(fileUrl, document.original_filename);
        a.rel = 'noopener';
        a.click();
    };

    return {
        // State
        isSelected,
        isDragging,
        isMobile,
        // Handlers
        handleClick,
        handleDoubleClick,
        handleOpen: navigateToDocument,
        handleDelete,
        handleDownload,
        // Selection-aware target ids: the whole selection when this card is selected, else just this doc
        targetIds: documentIds,
        // Drag props (spread onto DOM element)
        dragRef: setNodeRef,
        dragAttributes: attributes,
        dragListeners: listeners,
        longPressHandlers,
    };
}

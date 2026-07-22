import { useDeleteDocuments, useSetDocumentPrivacy } from '@/lib/api/documents';
import { buildDownloadUrl, buildFileUrl } from '@/lib/commonhelpers';
import { useConfirm } from '@/lib/confirm';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useLongPress } from '@/lib/hooks/useLongPress';
import { useSelectionOptional } from '@/lib/selection';
import { useVault } from '@/lib/vault';
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
    const setDocumentPrivacy = useSetDocumentPrivacy();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const isMobile = useIsMobile();
    const { requestUnlock } = useVault();

    const lastTapRef = useRef<{ id: string; time: number } | null>(null);
    const longPressFiredRef = useRef(false);

    const isSelected = selection?.isSelected(document.id) ?? false;
    const selectedIds = selection?.selectedIds ?? new Set<string>();
    const inSelectionMode = selectedIds.size > 0;

    // --- Navigation ---

    const navigateToDocument = useCallback(() => {
        // A locked private document can't be opened — prompt to unlock, then navigate by id
        // (the viewer refetches the now-unlocked content).
        if (document.locked) {
            requestUnlock(() => navigate({ to: '/document/$id', params: { id: document.id } }));

            return;
        }

        queryClient.setQueryData(['document', document.id], document);
        queryClient.invalidateQueries({ queryKey: ['document', document.id] });
        navigate({ to: '/document/$id', params: { id: document.id } });
    }, [queryClient, document, navigate, requestUnlock]);

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
        const count = selectedIds.size;
        const confirmed = await confirm({
            title: count === 1 ? 'Delete document?' : `Delete ${count} documents?`,
            description: 'This action cannot be undone.',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            variant: 'destructive',
        });

        if (!confirmed) return;

        const ids = Array.from(selectedIds);
        deleteDocuments.mutate(ids, {
            onSuccess: () => selection?.clear(),
        });
    };

    // --- Privacy ---

    const handleTogglePrivate = () => {
        // Removing privacy while locked would expose content without the password — unlock first.
        if (document.locked) {
            requestUnlock();

            return;
        }

        // Apply to the whole selection when this card is part of it, otherwise just this doc.
        const ids = isSelected && selectedIds.size > 0 ? Array.from(selectedIds) : [document.id];
        setDocumentPrivacy.mutate({ document_ids: ids, is_private: !document.is_private });
    };

    // --- Download ---

    const handleDownload = () => {
        // No signed URL is served for a locked document — prompt to unlock instead.
        if (document.locked) {
            requestUnlock();

            return;
        }

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
        isPrivate: document.is_private,
        isLocked: document.locked,
        // Handlers
        handleClick,
        handleDoubleClick,
        handleOpen: navigateToDocument,
        handleDelete,
        handleTogglePrivate,
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

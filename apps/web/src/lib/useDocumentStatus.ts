import type { Document, JobEvent } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { connectSocket, onJobEvents, subscribeToDocument, unsubscribeFromDocument } from './socket';

/**
 * Hook to subscribe to real-time status updates for a document
 * Updates the query cache when job events are received
 */
export function useDocumentStatus(documentId: string | undefined) {
    const queryClient = useQueryClient();

    const updateDocument = useCallback(
        (event: JobEvent) => {
            if (event.document_id !== documentId) return;

            // Update single document query
            queryClient.setQueryData<Document>(['document', documentId], (old) => {
                if (!old) return old;

                const updates: Partial<Document> = {};

                // Determine which status to update based on job type
                // We don't have job_type in the event, so we update based on status
                if (event.status === 'complete' || event.status === 'failed') {
                    // Check if this is OCR or thumbnail based on current statuses
                    if (old.ocr_status === 'processing') {
                        updates.ocr_status = event.status;
                    }
                    if (old.thumbnail_status === 'processing') {
                        updates.thumbnail_status = event.status;
                    }
                } else if (event.status === 'processing') {
                    if (old.ocr_status === 'pending') {
                        updates.ocr_status = 'processing';
                    }
                    if (old.thumbnail_status === 'pending') {
                        updates.thumbnail_status = 'processing';
                    }
                }

                return { ...old, ...updates };
            });

            // Also invalidate the documents list to refresh it
            if (event.status === 'complete') {
                queryClient.invalidateQueries({ queryKey: ['documents'] });
            }
        },
        [documentId, queryClient],
    );

    useEffect(() => {
        if (!documentId) return;

        const socket = connectSocket();
        subscribeToDocument(documentId);

        const cleanup = onJobEvents(updateDocument);

        return () => {
            cleanup();
            unsubscribeFromDocument(documentId);
        };
    }, [documentId, updateDocument]);
}

/**
 * Hook to subscribe to real-time updates for multiple documents
 * Useful for the browse page
 */
export function useDocumentsStatus(documentIds: string[]) {
    const queryClient = useQueryClient();

    const updateDocuments = useCallback(
        (event: JobEvent) => {
            if (!event.document_id || !documentIds.includes(event.document_id)) return;

            // Invalidate the documents list when any job completes
            if (event.status === 'complete') {
                queryClient.invalidateQueries({ queryKey: ['documents'] });
            }
        },
        [documentIds, queryClient],
    );

    useEffect(() => {
        if (documentIds.length === 0) return;

        const socket = connectSocket();

        // Subscribe to all document IDs
        for (const id of documentIds) {
            subscribeToDocument(id);
        }

        const cleanup = onJobEvents(updateDocuments);

        return () => {
            cleanup();
            for (const id of documentIds) {
                unsubscribeFromDocument(id);
            }
        };
    }, [documentIds, updateDocuments]);
}

import { documentsApi } from '@/lib/api/documents';
import { connectSocket, ensureSocketConnected, onJobEvents, subscribeToSession, unsubscribeFromSession } from '@/lib/socket';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

interface UseVideoSaveOptions {
    document: Document;
    start: number;
    end: number;
    saveAsCopy: boolean;
    onToggleEdit?: () => void;
}

export function useVideoSave({ document, start, end, saveAsCopy, onToggleEdit }: UseVideoSaveOptions) {
    const [isSaving, setIsSaving] = useState(false);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const cleanupRef = useRef<(() => void) | null>(null);

    const handleSave = useCallback(async () => {
        if (saveAsCopy && !document.folder_id) {
            toast.error('Document must be in a folder to save as copy');

            return;
        }

        setIsSaving(true);
        const sessionId = crypto.randomUUID();

        try {
            connectSocket();
            await ensureSocketConnected();
            subscribeToSession(sessionId);

            let capturedJobId: string | null = null;

            cleanupRef.current = onJobEvents((event) => {
                if (event.job_id !== capturedJobId) return;

                if (event.type === 'job:complete') {
                    const result = event.result as { newDocumentId?: string } | undefined;

                    if (saveAsCopy && result?.newDocumentId) {
                        queryClient.invalidateQueries({ queryKey: ['documents'] });
                        queryClient.invalidateQueries({ queryKey: ['sections', 'tree'] });
                        toast.success('Saved as copy');
                        onToggleEdit?.();
                        navigate({ to: '/document/$id', params: { id: result.newDocumentId } });
                    } else if (!saveAsCopy) {
                        queryClient.invalidateQueries({ queryKey: ['document', document.id] });
                        queryClient.invalidateQueries({ queryKey: ['documents'] });
                        toast.success('Saved');
                        onToggleEdit?.();
                    }

                    setIsSaving(false);
                    cleanupRef.current?.();
                    cleanupRef.current = null;
                    unsubscribeFromSession(sessionId);
                } else if (event.type === 'job:failed') {
                    toast.error(event.error_message ?? 'Failed to trim video');
                    setIsSaving(false);
                    cleanupRef.current?.();
                    cleanupRef.current = null;
                    unsubscribeFromSession(sessionId);
                }
            });

            const { jobId } = await documentsApi.trimVideo(document.id, {
                start,
                end,
                saveAsCopy,
                sessionId,
            });

            if (!jobId) {
                throw new Error('No job ID returned');
            }

            capturedJobId = jobId;
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to trim video');
            setIsSaving(false);
            cleanupRef.current?.();
            cleanupRef.current = null;
            unsubscribeFromSession(sessionId);
        }
    }, [document.id, document.folder_id, start, end, saveAsCopy, onToggleEdit, navigate, queryClient]);

    return { handleSave, isSaving };
}

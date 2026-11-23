import { documentsApi } from '@/lib/api/documents';
import { buildFileUrl } from '@/lib/commonhelpers';
import { documentKindOf, type Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/** Hover handler that warms what opening a document needs: its detail query and, for an image, the full-size file. */
export function usePrefetchDocument(document: Document): () => void {
    const queryClient = useQueryClient();

    return useCallback(() => {
        queryClient.prefetchQuery({ queryKey: ['document', document.id], queryFn: () => documentsApi.get(document.id) });

        if (documentKindOf(document.mime_type ?? '') !== 'image' || !document.file_url) return;

        const url = buildFileUrl(document.file_url);

        if (url) new Image().src = url;
    }, [queryClient, document.id, document.mime_type, document.file_url]);
}

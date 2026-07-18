import { documentsApi } from '@/lib/api/documents';
import { buildFileUrl, getThumbnailUrl } from '@/lib/commonhelpers';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { computeDestRect, mountDiveOverlay, settleDiveOverlay } from '../dive/diveTransition.js';

/**
 * DOM side of opening a document from the canvas.
 *
 * Hover prefetch warms the ['document', id] query AND the browser cache for
 * the exact lg thumbnail URL that query returns — signed-URL identity is what
 * makes the viewer's first paint pixel-identical to the dive overlay.
 */
export function useOpenDocumentFromCanvas() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const prefetchDocument = useCallback(
        (doc: Document) => {
            void queryClient
                .prefetchQuery({
                    queryKey: ['document', doc.id],
                    queryFn: () => documentsApi.get(doc.id),
                    staleTime: 30_000,
                })
                .then(() => {
                    const cached = queryClient.getQueryData<Document>(['document', doc.id]) ?? doc;
                    const lgUrl = getThumbnailUrl(cached, 'lg');

                    if (lgUrl) new Image().src = lgUrl;

                    if (cached.mime_type?.startsWith('image/')) {
                        const fileUrl = buildFileUrl(cached.file_url);

                        if (fileUrl) new Image().src = fileUrl;
                    }
                });
        },
        [queryClient],
    );

    /** Direct navigation (reduced-motion path). */
    const openDocument = useCallback(
        (doc: Document) => {
            navigate({ to: '/document/$id', params: { id: doc.id } });
        },
        [navigate],
    );

    /** Dive flight landed: mount the pixel-matched overlay, then navigate under it. */
    const completeDive = useCallback(
        async (doc: Document) => {
            const cached = queryClient.getQueryData<Document>(['document', doc.id]) ?? doc;
            const imageUrl = getThumbnailUrl(cached, 'lg') ?? getThumbnailUrl(cached, 'sm');
            const mime = cached.mime_type ?? '';
            // Image and video viewers both paint a [data-doc-hero] (their poster
            // is this exact overlay image), so the FLIP settle can land on it.
            const rendersHero = mime.startsWith('image/') || mime.startsWith('video/');

            await mountDiveOverlay(computeDestRect(cached), imageUrl);
            navigate({ to: '/document/$id', params: { id: doc.id } });
            // Viewers without a hero (PDF/txt) never paint one, so let the overlay
            // yield to them quickly instead of holding the backdrop.
            settleDiveOverlay(rendersHero ? {} : { heroTimeoutMs: 250 });
        },
        [queryClient, navigate],
    );

    return { prefetchDocument, openDocument, completeDive };
}

import { documentsApi } from '@/lib/api/documents';
import { useAuth } from '@/lib/auth';
import type { Document } from '@reverie/shared';
import { useQueries } from '@tanstack/react-query';

const PREVIEW_LIMIT = 6;
const MAX_TRACKED_FOLDERS = 30;
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Per-folder preview documents for island stacks, driven by which islands
 * are visible. Query keys match the useDocuments convention
 * (['documents', options]) so broad invalidations keep the canvas fresh and
 * findCachedDocument can serve these docs as placeholders.
 */
export function useIslandPreviews(folderIds: string[]): Record<string, Document[]> {
    const { isAuthenticated } = useAuth();
    const ids = folderIds.slice(0, MAX_TRACKED_FOLDERS);

    return useQueries({
        queries: ids.map((folderId) => ({
            queryKey: ['documents', { folderId, limit: PREVIEW_LIMIT }],
            queryFn: () => documentsApi.list({ folderId, limit: PREVIEW_LIMIT }),
            enabled: isAuthenticated,
            staleTime: STALE_TIME_MS,
        })),
        combine: (results) => {
            const map: Record<string, Document[]> = {};

            results.forEach((result, i) => {
                const id = ids[i];

                if (id && result.data) map[id] = result.data.items;
            });

            return map;
        },
    });
}

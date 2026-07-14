import { useInfiniteDocuments } from '@/lib/api/documents';
import type { UnraveledFolder } from '../types.js';

/**
 * Documents for the currently unraveled folder — the exact same infinite
 * query Browse uses (shared pages both directions). V1 fans out page 1 only;
 * the overlay chip links to Browse for the rest.
 */
export function useUnraveledDocuments(folderId: string | null): UnraveledFolder | null {
    const query = useInfiniteDocuments({ folderId, enabled: folderId !== null });

    if (!folderId || !query.data) return null;

    const firstPage = query.data.pages[0];

    if (!firstPage) return null;

    return { folderId, documents: firstPage.items, totalCount: firstPage.total };
}

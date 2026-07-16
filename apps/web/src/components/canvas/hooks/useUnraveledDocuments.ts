import { useInfiniteDocuments } from '@/lib/api/documents';
import { canvasQuality } from '../canvasQuality.js';
import type { UnraveledFolder } from '../types.js';

/**
 * Documents for the currently unraveled folder — the exact same infinite
 * query Browse uses (shared pages both directions; never fork the key). Fans
 * out page 1 only, capped per device class (phones fan fewer cards); the
 * overlay chip links to Browse for the rest.
 */
export function useUnraveledDocuments(folderId: string | null): UnraveledFolder | null {
    const query = useInfiniteDocuments({ folderId, enabled: folderId !== null });

    if (!folderId || !query.data) return null;

    const firstPage = query.data.pages[0];

    if (!firstPage) return null;

    return { folderId, documents: firstPage.items.slice(0, canvasQuality.fanPageLimit), totalCount: firstPage.total };
}

import type { Document } from '@reverie/shared';
import type { InfiniteData } from '@tanstack/react-query';

type DocumentsPage = { items: Document[]; total: number; limit: number; offset: number };
export type DocumentsCache = DocumentsPage | InfiniteData<DocumentsPage>;

function isInfinite(cache: DocumentsCache): cache is InfiniteData<DocumentsPage> {
    return 'pages' in cache && Array.isArray(cache.pages);
}

function itemsOf(cache: DocumentsCache | undefined): Document[] {
    if (!cache) return [];

    return isInfinite(cache) ? cache.pages.flatMap((page) => page.items) : (cache.items ?? []);
}

/**
 * The cached list without `ids`, its total lowered by what it actually held. Each kind (and folder) has its own list
 * in the cache: deleting a photo must not lower the total of the Files list, which never held it.
 */
export function withoutDocuments(cache: DocumentsCache, ids: string[]): DocumentsCache {
    const gone = new Set(ids);
    const removed = itemsOf(cache).filter((doc) => gone.has(doc.id)).length;

    if (isInfinite(cache)) {
        const pages = cache.pages.map((page, index) => ({
            ...page,
            items: page.items.filter((doc) => !gone.has(doc.id)),
            ...(index === 0 && { total: Math.max(0, page.total - removed) }),
        }));

        return { ...cache, pages };
    }

    return { ...cache, items: cache.items.filter((doc) => !gone.has(doc.id)), total: Math.max(0, cache.total - removed) };
}

/**
 * How many of `ids` each folder loses. A document sits in several cached lists (All and its kind's, library-wide and
 * its folder's), so each id is counted once however many hold it.
 */
export function folderCountDecrements(caches: Array<DocumentsCache | undefined>, ids: string[]): Map<string, number> {
    const wanted = new Set(ids);
    const counted = new Set<string>();
    const decrements = new Map<string, number>();

    for (const cache of caches) {
        for (const doc of itemsOf(cache)) {
            if (!wanted.has(doc.id) || counted.has(doc.id) || !doc.folder_id) continue;

            counted.add(doc.id);
            decrements.set(doc.folder_id, (decrements.get(doc.folder_id) ?? 0) + 1);
        }
    }

    return decrements;
}

import type { Document } from '@reverie/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { produce } from 'immer';

type DocumentsPage = { items: Document[]; total: number; limit: number; offset: number };
export type DocumentsCache = DocumentsPage | InfiniteData<DocumentsPage>;

function isPage(data: object): data is DocumentsPage {
    return 'items' in data && Array.isArray(data.items);
}

function isInfinite(data: object): data is InfiniteData<DocumentsPage> {
    return 'pages' in data && Array.isArray(data.pages);
}

/**
 * Whether a `['documents']` cache entry is a list of documents (a page or an infinite list of pages). Not every entry
 * under that prefix is: the Browse summary (per-kind totals) lives there too, so the optimistic writers must check
 * before they treat an entry as a list.
 */
export function isDocumentsList(data: unknown): data is DocumentsCache {
    if (typeof data !== 'object' || data === null) return false;

    return isPage(data) || isInfinite(data);
}

function itemsOf(cache: unknown): Document[] {
    if (!isDocumentsList(cache)) return [];

    return isInfinite(cache) ? cache.pages.flatMap((page) => page.items) : cache.items;
}

/**
 * The cached list without `ids`, its total lowered by what it actually held. Each kind (and folder) has its own list
 * in the cache: deleting a photo must not lower the total of the Files list, which never held it. An entry that is not
 * a list (the summary) is returned as it is.
 */
export function withoutDocuments<T>(cache: T, ids: string[]): T {
    if (!isDocumentsList(cache)) return cache;

    const gone = new Set(ids);
    const removed = itemsOf(cache).filter((doc) => gone.has(doc.id)).length;

    if (isInfinite(cache)) {
        const pages = cache.pages.map((page, index) => ({
            ...page,
            items: page.items.filter((doc) => !gone.has(doc.id)),
            ...(index === 0 && { total: Math.max(0, page.total - removed) }),
        }));

        return { ...cache, pages } as T;
    }

    return { ...cache, items: cache.items.filter((doc) => !gone.has(doc.id)), total: Math.max(0, cache.total - removed) } as T;
}

/** The cached list with the documents in `ids` now in `folderId`. An entry that is not a list (the summary) is returned as it is. */
export function withDocumentsMoved<T>(cache: T, ids: string[], folderId: string): T {
    if (!isDocumentsList(cache)) return cache;

    const moved = new Set(ids);

    const move = (items: Document[]) => {
        for (const doc of items) {
            if (moved.has(doc.id)) doc.folder_id = folderId;
        }
    };

    return produce(cache as DocumentsCache, (draft) => {
        if (isInfinite(draft)) {
            draft.pages.forEach((page) => move(page.items));

            return;
        }

        move(draft.items);
    }) as T;
}

/**
 * How many of `ids` each folder loses. A document sits in several cached lists (All and its kind's, library-wide and
 * its folder's), so each id is counted once however many hold it.
 */
export function folderCountDecrements(caches: unknown[], ids: string[]): Map<string, number> {
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

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

function itemsOf(cache: DocumentsCache): Document[] {
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

/** The cached list with the documents in `ids` now in `folderId` (null: the top level). An entry that is not a list (the summary) is returned as it is. */
export function withDocumentsMoved<T>(cache: T, ids: string[], folderId: string | null): T {
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

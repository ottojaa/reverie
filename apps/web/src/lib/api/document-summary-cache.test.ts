import type { DocumentSummaryResponse } from '@reverie/shared';
import { QueryClient, QueryObserver, type InfiniteData } from '@tanstack/react-query';
import type { Document } from '@reverie/shared';
import { describe, expect, it, vi } from 'vitest';
import { isDocumentsList, withDocumentsMoved, withoutDocuments } from './document-cache';
import { documentSummaryKey, infiniteDocumentsKey, toInfiniteDocumentsOptions, type DocumentsResponse } from './documents';

function doc(id: string, folder_id: string | null = 'f1'): Document {
    return { id, folder_id } as Document;
}

function summary(photos: number): DocumentSummaryResponse {
    return { image: { count: photos, bytes: photos * 10 }, video: { count: 0, bytes: 0 }, file: { count: 3, bytes: 30, top_types: [{ ext: 'md', count: 3 }] } };
}

function page(items: Document[], total = items.length): DocumentsResponse {
    return { items, total, limit: 24, offset: 0 };
}

function infinite(items: Document[], total = items.length): InfiniteData<DocumentsResponse> {
    return { pageParams: [0], pages: [page(items, total)] };
}

/** A cache holding what Browse holds: the summary, a preview page and the infinite Recently added list. */
function browseCache() {
    const client = new QueryClient();
    const recent = infiniteDocumentsKey(toInfiniteDocumentsOptions({ folderId: null }));
    const preview = ['documents', { folderId: null, kind: 'image', limit: 6 }];

    client.setQueryData(documentSummaryKey(null), summary(2));
    client.setQueryData(preview, page([doc('a'), doc('b')], 2));
    client.setQueryData(recent, infinite([doc('a'), doc('b'), doc('c')]));

    return { client, recent, preview };
}

describe('isDocumentsList', () => {
    it('accepts a page and an infinite list, and refuses the summary and anything else', () => {
        expect(isDocumentsList(page([]))).toBe(true);
        expect(isDocumentsList(infinite([]))).toBe(true);
        expect(isDocumentsList(summary(1))).toBe(false);
        expect(isDocumentsList(undefined)).toBe(false);
        expect(isDocumentsList(null)).toBe(false);
        expect(isDocumentsList('x')).toBe(false);
    });
});

describe('the summary next to the lists', () => {
    it('is left as it is by the delete writer, which still lowers the lists', () => {
        const { client, recent, preview } = browseCache();

        client.setQueriesData({ queryKey: ['documents'] }, (old) => (old ? withoutDocuments(old, ['a']) : old));

        expect(client.getQueryData(documentSummaryKey(null))).toEqual(summary(2));
        expect(client.getQueryData<InfiniteData<DocumentsResponse>>(recent)?.pages[0]?.items.map((d) => d.id)).toEqual(['b', 'c']);
        expect(client.getQueryData<InfiniteData<DocumentsResponse>>(recent)?.pages[0]?.total).toBe(2);
        expect(client.getQueryData<DocumentsResponse>(preview)?.total).toBe(1);
    });

    it('is left as it is by the move writer, which still moves documents in the lists', () => {
        const { client, recent, preview } = browseCache();

        client.setQueriesData({ queryKey: ['documents'] }, (old) => (old ? withDocumentsMoved(old, ['a'], 'f2') : old));

        expect(client.getQueryData(documentSummaryKey(null))).toEqual(summary(2));
        expect(client.getQueryData<InfiniteData<DocumentsResponse>>(recent)?.pages[0]?.items.map((d) => d.folder_id)).toEqual(['f2', 'f1', 'f1']);
        expect(client.getQueryData<DocumentsResponse>(preview)?.items.map((d) => d.folder_id)).toEqual(['f2', 'f1']);
    });

    it('is refetched when the documents are invalidated after a delete or a move', async () => {
        const { client } = browseCache();
        let served = 2;
        const queryFn = vi.fn(async () => summary(served));
        const observer = new QueryObserver(client, { queryKey: documentSummaryKey(null), queryFn, staleTime: Infinity });
        const unsubscribe = observer.subscribe(() => undefined);

        // The observer starts from the cached summary and, being fresh, does not fetch yet.
        expect(queryFn).toHaveBeenCalledTimes(0);

        client.setQueriesData({ queryKey: ['documents'] }, (old) => (old ? withoutDocuments(old, ['a']) : old));
        served = 1;
        await client.invalidateQueries({ queryKey: ['documents'] });

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(client.getQueryData(documentSummaryKey(null))).toEqual(summary(1));

        client.setQueriesData({ queryKey: ['documents'] }, (old) => (old ? withDocumentsMoved(old, ['b'], 'f2') : old));
        await client.invalidateQueries({ queryKey: ['documents'] });

        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(isDocumentsList(client.getQueryData(documentSummaryKey(null)))).toBe(false);

        unsubscribe();
    });
});

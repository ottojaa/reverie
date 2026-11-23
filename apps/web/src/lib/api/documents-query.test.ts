import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Document } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { folderCountDecrements, withoutDocuments, type DocumentsCache } from './document-cache';
import { firstPageTotal, infiniteDocumentsKey, toDocumentListParams, toInfiniteDocumentsOptions, type DocumentsResponse } from './documents';

function doc(id: string, folder_id: string | null = 'f1'): Document {
    return { id, folder_id } as Document;
}

function infinite(total: number, ...pages: Document[][]): InfiniteData<DocumentsResponse> {
    return {
        pageParams: pages.map((_, i) => i * 24),
        pages: pages.map((items, i) => ({ items, total, limit: 24, offset: i * 24 })),
    };
}

describe('per-tab queries', () => {
    it('asks the server for the tab own kind', () => {
        expect(toDocumentListParams({ folderId: 'f1', kind: 'video' })).toMatchObject({ folder_id: 'f1', kind: 'video' });
        expect(toDocumentListParams({ folderId: 'f1' })).not.toHaveProperty('kind');
    });

    it('puts the kind in the query key, so each tab keeps its own pages', () => {
        const all = infiniteDocumentsKey(toInfiniteDocumentsOptions({ folderId: 'f1' }));
        const photos = infiniteDocumentsKey(toInfiniteDocumentsOptions({ folderId: 'f1', kind: 'image' }));
        const videos = infiniteDocumentsKey(toInfiniteDocumentsOptions({ folderId: 'f1', kind: 'video' }));

        const cache = new QueryClient();
        cache.setQueryData(all, infinite(250, [doc('a')]));
        cache.setQueryData(photos, infinite(168, [doc('b')]));

        expect(cache.getQueryData<InfiniteData<DocumentsResponse>>(photos)?.pages[0]?.total).toBe(168);
        expect(cache.getQueryData<InfiniteData<DocumentsResponse>>(all)?.pages[0]?.total).toBe(250);
        expect(cache.getQueryData(videos)).toBeUndefined();
    });

    it('keeps the key an unfiltered list had before kinds existed (canvas, sidebar prefetch)', () => {
        expect(infiniteDocumentsKey(toInfiniteDocumentsOptions({ folderId: 'f1' }))).toEqual(['documents', 'infinite', { folderId: 'f1', limit: 24 }]);
        expect(infiniteDocumentsKey(toInfiniteDocumentsOptions({}))).toEqual(['documents', 'infinite', { folderId: null, limit: 24 }]);
    });
});

describe('firstPageTotal', () => {
    it('is the total on the list own first page', () => {
        expect(firstPageTotal(infinite(58, [doc('a')], [doc('b')]))).toBe(58);
    });

    it('is 0 before anything has loaded', () => {
        expect(firstPageTotal(undefined)).toBe(0);
        expect(firstPageTotal({ pages: [], pageParams: [] })).toBe(0);
    });
});

describe('deleting documents from overlapping caches', () => {
    const photo = doc('photo-1');
    const all = infinite(250, [photo, doc('file-1')]);
    const photos = infinite(168, [photo, doc('photo-2')]);
    const files = infinite(58, [doc('file-1'), doc('file-2')]);

    it('lowers a list total only by what that list held', () => {
        const afterAll = withoutDocuments(all, ['photo-1']) as InfiniteData<DocumentsResponse>;
        const afterPhotos = withoutDocuments(photos, ['photo-1']) as InfiniteData<DocumentsResponse>;
        const afterFiles = withoutDocuments(files, ['photo-1']) as InfiniteData<DocumentsResponse>;

        expect(afterAll.pages[0]?.total).toBe(249);
        expect(afterPhotos.pages[0]?.total).toBe(167);
        expect(afterFiles.pages[0]?.total).toBe(58);
        expect(afterPhotos.pages[0]?.items.map((d) => d.id)).toEqual(['photo-2']);
    });

    it('does not mutate the cache it was given', () => {
        withoutDocuments(photos, ['photo-1']);

        expect(photos.pages[0]?.items).toHaveLength(2);
        expect(photos.pages[0]?.total).toBe(168);
    });

    it('handles a plain, non-infinite list too', () => {
        const plain: DocumentsCache = { items: [photo, doc('x')], total: 2, limit: 24, offset: 0 };

        expect(withoutDocuments(plain, ['photo-1'])).toMatchObject({ total: 1, items: [{ id: 'x' }] });
    });

    it('counts the sidebar folder once however many caches hold the document', () => {
        const decrements = folderCountDecrements([all, photos, files, undefined], ['photo-1']);

        expect(decrements.get('f1')).toBe(1);
        expect(decrements.size).toBe(1);
    });

    it('counts each deleted document against its own folder', () => {
        const caches = [infinite(3, [doc('a', 'f1'), doc('b', 'f2'), doc('c', null)]), infinite(2, [doc('a', 'f1'), doc('b', 'f2')])];

        const decrements = folderCountDecrements(caches, ['a', 'b', 'c']);

        expect([...decrements]).toEqual([
            ['f1', 1],
            ['f2', 1],
        ]);
    });
});

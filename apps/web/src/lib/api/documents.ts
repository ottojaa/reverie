import {
    CHECK_CONTENT_MAX_FILES,
    CheckContentResponseSchema,
    CheckDuplicatesResponseSchema,
    DocumentListResponseSchema,
    DocumentOcrResultSchema,
    DocumentSchema,
    DocumentSummaryResponseSchema,
    JobIdResponseSchema,
    TrimVideoResponseSchema,
    type CheckContentResult,
    type CheckDuplicatesResponse,
    type Document,
    type DocumentKind,
    type DocumentOcrResult,
    type DocumentSummaryResponse,
} from '@reverie/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiClient } from './client';
import { useAuth } from '../auth';
import { withoutDocuments } from './document-cache';

export type DocumentsResponse = {
    items: Document[];
    total: number;
    limit: number;
    offset: number;
};

interface UseDocumentsOptions {
    folderId?: string | null;
    limit?: number;
    offset?: number;
    /** Only documents of this kind (by MIME type); `total` of the response is then that kind's total. */
    kind?: DocumentKind | undefined;
    /** Only documents whose text recognition, thumbnail or AI summary is still pending or running; `total` is then that count. */
    processing?: boolean | undefined;
    /** With `kind`: order for a cover, screenshots and screen recordings last. Leave out for a list by date. */
    preview?: boolean | undefined;
}

/** The query string of `GET /documents`: `kind` is sent only when set, so an omitted kind is exactly today's request. */
export function toDocumentListParams(options: UseDocumentsOptions): Record<string, string> {
    const params: Record<string, string> = {};

    if (options.folderId) params.folder_id = options.folderId;

    if (options.limit) params.limit = String(options.limit);

    if (options.offset !== undefined && options.offset > 0) params.offset = String(options.offset);

    if (options.kind) params.kind = options.kind;

    if (options.processing) params.processing = 'true';

    if (options.preview) params.preview = 'true';

    return params;
}

/** How the upload checks name where files are going: a folder, or null for the top level. */
export function toDestinationParams(folderId: string | null): { folder_id: string } | { top_level: true } {
    return folderId === null ? { top_level: true } : { folder_id: folderId };
}

export const documentsApi = {
    async list(options: UseDocumentsOptions = {}): Promise<DocumentsResponse> {
        const { data } = await apiClient.get('/documents', { params: toDocumentListParams(options) });

        return DocumentListResponseSchema.parse(data);
    },

    /** What a folder (the library when omitted) holds per kind: the figures behind the Browse dashboard's cards. */
    async summary(folderId?: string | null): Promise<DocumentSummaryResponse> {
        const { data } = await apiClient.get('/documents/summary', { params: folderId ? { folder_id: folderId } : {} });

        return DocumentSummaryResponseSchema.parse(data);
    },

    async get(documentId: string): Promise<Document> {
        const { data } = await apiClient.get(`/documents/${documentId}`);

        return DocumentSchema.parse(data);
    },

    async delete(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        if (ids.length === 1) {
            await apiClient.delete(`/documents/${ids[0]}`);

            return;
        }

        await apiClient.delete('/documents', { data: { ids } });
    },

    async checkDuplicates(folderId: string | null, filenames: string[]): Promise<CheckDuplicatesResponse> {
        if (filenames.length === 0) return { duplicates: [] };

        const { data } = await apiClient.post('/documents/check-duplicates', {
            ...toDestinationParams(folderId),
            filenames,
        });

        return CheckDuplicatesResponseSchema.parse(data);
    },

    /**
     * Which of these files' content is already in the library, and whether the name is taken in `folderId` (null: the top level).
     * Results come back in the order of `files`; more than one request is made past the server's per-call limit.
     */
    async checkContent(folderId: string | null, files: Array<{ name: string; sha256?: string }>): Promise<CheckContentResult[]> {
        const results: CheckContentResult[] = [];

        for (let start = 0; start < files.length; start += CHECK_CONTENT_MAX_FILES) {
            const { data } = await apiClient.post('/documents/check-content', {
                ...toDestinationParams(folderId),
                files: files.slice(start, start + CHECK_CONTENT_MAX_FILES),
            });

            results.push(...CheckContentResponseSchema.parse(data).results);
        }

        return results;
    },

    async reprocessLlm(documentId: string) {
        const { data } = await apiClient.post(`/documents/${documentId}/reprocess-llm`);

        return JobIdResponseSchema.parse(data);
    },

    async getOcr(documentId: string): Promise<DocumentOcrResult> {
        const { data } = await apiClient.get(`/documents/${documentId}/ocr`);

        return DocumentOcrResultSchema.parse(data);
    },

    async retryOcr(documentId: string) {
        const { data } = await apiClient.post(`/documents/${documentId}/ocr/retry`);

        return JobIdResponseSchema.parse(data);
    },

    async move(params: { document_ids: string[]; folder_id: string | null; conflict_strategy?: 'replace' | 'keep_both' }): Promise<void> {
        await apiClient.patch('/documents/move', params);
    },

    async update(documentId: string, params: { original_filename: string }): Promise<Document> {
        const { data } = await apiClient.patch(`/documents/${documentId}`, params);

        return DocumentSchema.parse(data);
    },

    async replaceFile(documentId: string, file: File): Promise<Document> {
        const formData = new FormData();

        formData.append('file', file);

        const { data } = await apiClient.patch(`/documents/${documentId}/file`, formData);

        return DocumentSchema.parse(data);
    },

    async trimVideo(documentId: string, params: { start: number; end: number; saveAsCopy: boolean; sessionId?: string }): Promise<{ jobId: string }> {
        const { data } = await apiClient.post(`/documents/${documentId}/trim`, params);

        return TrimVideoResponseSchema.parse(data);
    },
};

export type { CheckDuplicatesResponse, DocumentOcrResult };

/**
 * Hook to fetch documents (uses auth fetch so 401 triggers refresh + retry)
 */
export function useDocuments(options: UseDocumentsOptions = {}, enabled = true) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['documents', options],
        queryFn: () => documentsApi.list(options),
        enabled: isAuthenticated && enabled,
    });
}

/**
 * The summary's key. It sits under `['documents']`, so every invalidation of the lists refreshes it too; the optimistic
 * writers skip it because it is not a list (see isDocumentsList).
 */
export function documentSummaryKey(folderId: string | null) {
    return ['documents', 'summary', folderId] as const;
}

/** The per-kind totals of a folder (of the library when null). Held back while `enabled` is false (a locked folder). */
export function useDocumentSummary(folderId: string | null, enabled = true) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: documentSummaryKey(folderId),
        queryFn: () => documentsApi.summary(folderId),
        enabled: isAuthenticated && enabled,
    });
}

/** How many still-processing documents of a folder the badge follows; it shows only that some are, so a page is plenty. */
const PROCESSING_PAGE_SIZE = 50;

/** The documents of a folder (of the library when null) that are still being processed, whatever their kind. */
export function useProcessingDocuments(folderId: string | null) {
    return useDocuments({ folderId, limit: PROCESSING_PAGE_SIZE, processing: true });
}

const DEFAULT_PAGE_SIZE = 24;

/** What identifies one infinite list: its folder, page size and (when filtered) kind. */
type InfiniteDocumentsOptions = { folderId: string | null; limit: number; kind?: DocumentKind };

/** The folder, page size and kind an infinite list is cached under. */
export function toInfiniteDocumentsOptions(options: Pick<UseDocumentsOptions, 'folderId' | 'limit' | 'kind'>): InfiniteDocumentsOptions {
    return {
        folderId: options.folderId ?? null,
        limit: options.limit ?? DEFAULT_PAGE_SIZE,
        // Left out when unset: an unfiltered list keeps the key it had before kinds existed (canvas, sidebar prefetch).
        ...(options.kind && { kind: options.kind }),
    };
}

/** The one place the infinite list's query key is built (hook and prefetch share it). */
export function infiniteDocumentsKey(options: InfiniteDocumentsOptions) {
    return ['documents', 'infinite', options] as const;
}

/** The server's total for the list, from its own first page (every page carries it; the first is the freshest). */
export function firstPageTotal(data: InfiniteData<DocumentsResponse> | undefined): number {
    return data?.pages[0]?.total ?? 0;
}

/**
 * Infinite scroll documents (offset-based pagination, use in Browse)
 */
export function useInfiniteDocuments(options: UseDocumentsOptions & { enabled?: boolean } = {}) {
    const { isAuthenticated } = useAuth();

    const stableOptions = toInfiniteDocumentsOptions(options);

    return useInfiniteQuery({
        queryKey: infiniteDocumentsKey(stableOptions),
        queryFn: ({ pageParam }) =>
            documentsApi.list({
                ...stableOptions,
                offset: pageParam as number,
            }),
        initialPageParam: 0,
        getNextPageParam: (lastPage) => {
            const nextOffset = lastPage.offset + lastPage.limit;

            return nextOffset < lastPage.total ? nextOffset : undefined;
        },

        enabled: isAuthenticated && (options.enabled ?? true),
    });
}

/**
 * Prefetch the first infinite page for a folder with the exact same query
 * key as useInfiniteDocuments (canvas approach-prefetch, sidebar hover).
 */
export function usePrefetchInfiniteDocuments() {
    const queryClient = useQueryClient();

    return useCallback(
        (folderId: string) => {
            const stableOptions = toInfiniteDocumentsOptions({ folderId });
            queryClient.prefetchInfiniteQuery({
                queryKey: infiniteDocumentsKey(stableOptions),
                queryFn: ({ pageParam }) => documentsApi.list({ ...stableOptions, offset: pageParam as number }),
                initialPageParam: 0,
            });
        },
        [queryClient],
    );
}

/**
 * Prefetch documents for a section (e.g. on sidebar hover)
 */
export function usePrefetchDocuments() {
    const queryClient = useQueryClient();

    return useCallback(
        (folderId: string | null | undefined) => {
            const options = { limit: 50, ...(folderId && { folderId }) };
            queryClient.prefetchQuery({
                queryKey: ['documents', options],
                queryFn: () => documentsApi.list(options),
            });
        },
        [queryClient],
    );
}

/**
 * Hook to reprocess LLM for a document (regenerate summary)
 */
export function useReprocessLlm() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (documentId: string) => documentsApi.reprocessLlm(documentId),
        onSuccess: (_, documentId) => {
            queryClient.setQueryData<Document>(['document', documentId], (old) => (old ? { ...old, llm_status: 'pending' } : old));
            queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
        onError: () => {
            toast.error('Failed to reprocess');
        },
    });
}

/**
 * Find a document in list/infinite query caches (e.g. after navigating from Browse).
 */
export function findCachedDocument(queryClient: QueryClient, documentId: string): Document | undefined {
    const entries = queryClient.getQueriesData<unknown>({ queryKey: ['documents'] });

    for (const [key, data] of entries) {
        if (!data) continue;

        if (key[1] === 'infinite') {
            const infinite = data as InfiniteData<DocumentsResponse>;

            if (!infinite.pages) continue;

            for (const page of infinite.pages) {
                const found = page.items.find((d) => d.id === documentId);

                if (found) return found;
            }

            continue;
        }

        const list = data as DocumentsResponse;

        if (!Array.isArray(list.items)) continue;

        const found = list.items.find((d) => d.id === documentId);

        if (found) return found;
    }

    return undefined;
}

/**
 * Hook to fetch a single document (uses auth fetch for 401 refresh + retry)
 */
export function useDocument(documentId: string) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    return useQuery({
        queryKey: ['document', documentId],
        queryFn: () => documentsApi.get(documentId),
        enabled: isAuthenticated && !!documentId,
        placeholderData: () => findCachedDocument(queryClient, documentId),
    });
}

/**
 * Hook to fetch OCR result for a document (only when ocr_status is complete)
 */
export function useOcrResult(documentId: string, enabled: boolean) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['document', documentId, 'ocr'],
        queryFn: () => documentsApi.getOcr(documentId),
        enabled: isAuthenticated && !!documentId && enabled,
    });
}

/**
 * Hook to run or retry OCR for a document (force reprocess)
 */
export function useRetryOcr() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (documentId: string) => documentsApi.retryOcr(documentId),
        onSuccess: (_, documentId) => {
            queryClient.setQueryData<Document>(['document', documentId], (old) => (old ? { ...old, ocr_status: 'pending' } : old));
            queryClient.removeQueries({ queryKey: ['document', documentId, 'ocr'] });
            queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
        onError: () => {
            toast.error('Failed to run OCR');
        },
    });
}

/**
 * Hook to update document (rename)
 */
export function useUpdateDocument() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ documentId, original_filename }: { documentId: string; original_filename: string }) =>
            documentsApi.update(documentId, { original_filename }),
        onSuccess: (_, { documentId }) => {
            queryClient.invalidateQueries({ queryKey: ['document', documentId] });
            queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
        onError: () => {
            toast.error('Failed to rename document');
        },
    });
}

/**
 * Hook to replace document file (for image editor save-overwrite)
 */
export function useReplaceDocumentFile() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ documentId, file }: { documentId: string; file: File }) => documentsApi.replaceFile(documentId, file),
        onSuccess: (data) => {
            queryClient.setQueryData(['document', data.id], data);
            queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
        onError: () => {
            toast.error('Failed to save image');
        },
    });
}

/**
 * Hook to delete documents with optimistic updates (uses auth fetch for 401 refresh + retry)
 */
export function useDeleteDocuments() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (ids: string[]) => documentsApi.delete(ids),
        onMutate: async (ids) => {
            await queryClient.cancelQueries({ queryKey: ['documents'] });
            const previous = queryClient.getQueriesData({ queryKey: ['documents'] });

            queryClient.setQueriesData({ queryKey: ['documents'] }, (old) => (old ? withoutDocuments(old, ids) : old));

            return { previous };
        },
        onSuccess: (_, ids) => {
            toast.success(ids.length === 1 ? 'Document moved to Trash' : `${ids.length} documents moved to Trash`);
        },
        onError: (_, __, context) => {
            if (context?.previous) {
                context.previous.forEach(([queryKey, data]) => {
                    queryClient.setQueryData(queryKey, data);
                });
            }

            toast.error('Failed to move documents to Trash');
        },
        onSettled: (_, __, ids) => {
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['sections'] });
            queryClient.invalidateQueries({ queryKey: ['user'] });
            queryClient.invalidateQueries({ queryKey: ['trash'] });
            ids.forEach((id) => queryClient.removeQueries({ queryKey: ['document', id] }));
        },
    });
}

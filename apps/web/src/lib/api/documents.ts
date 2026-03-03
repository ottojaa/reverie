import {
    CheckDuplicatesResponseSchema,
    DocumentListResponseSchema,
    DocumentOcrResultSchema,
    DocumentSchema,
    JobIdResponseSchema,
    TrimVideoResponseSchema,
    type CheckDuplicatesResponse,
    type Document,
    type DocumentOcrResult,
    type FolderWithChildren,
} from '@reverie/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiClient } from './client';
import { useAuth } from '../auth';

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
}

export const documentsApi = {
    async list(options: UseDocumentsOptions = {}): Promise<DocumentsResponse> {
        const params: Record<string, string> = {};

        if (options.folderId) params.folder_id = options.folderId;

        if (options.limit) params.limit = String(options.limit);

        if (options.offset !== undefined && options.offset > 0) params.offset = String(options.offset);

        const { data } = await apiClient.get('/documents', { params });

        return DocumentListResponseSchema.parse(data);
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

    async checkDuplicates(folderId: string, filenames: string[]): Promise<CheckDuplicatesResponse> {
        if (filenames.length === 0) return { duplicates: [] };

        const { data } = await apiClient.post('/documents/check-duplicates', {
            folder_id: folderId,
            filenames,
        });

        return CheckDuplicatesResponseSchema.parse(data);
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

    async move(params: {
        document_ids: string[];
        folder_id: string;
        conflict_strategy?: 'replace' | 'keep_both';
    }): Promise<void> {
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

    async trimVideo(
        documentId: string,
        params: { start: number; end: number; saveAsCopy: boolean; sessionId?: string },
    ): Promise<{ jobId: string }> {
        const { data } = await apiClient.post(`/documents/${documentId}/trim`, params);

        return TrimVideoResponseSchema.parse(data);
    },
};

export type { CheckDuplicatesResponse, DocumentOcrResult };

/**
 * Hook to fetch documents (uses auth fetch so 401 triggers refresh + retry)
 */
export function useDocuments(options: UseDocumentsOptions = {}) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['documents', options],
        queryFn: () => documentsApi.list(options),
        enabled: isAuthenticated,
    });
}

const DEFAULT_PAGE_SIZE = 24;

/**
 * Infinite scroll documents (offset-based pagination, use in Browse)
 */
export function useInfiniteDocuments(options: UseDocumentsOptions = {}) {
    const { isAuthenticated } = useAuth();

    const stableOptions = {
        folderId: options.folderId ?? null,
        limit: options.limit ?? DEFAULT_PAGE_SIZE,
    };

    return useInfiniteQuery({
        queryKey: ['documents', 'infinite', stableOptions],
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

        enabled: isAuthenticated,
    });
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
            queryClient.setQueryData<Document>(['document', documentId], (old) =>
                old ? { ...old, llm_status: 'pending' } : old,
            );
            queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
        onError: () => {
            toast.error('Failed to reprocess');
        },
    });
}

/**
 * Hook to fetch a single document (uses auth fetch for 401 refresh + retry)
 */
export function useDocument(documentId: string) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['document', documentId],
        queryFn: () => documentsApi.get(documentId),
        enabled: isAuthenticated && !!documentId,
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
            queryClient.setQueryData<Document>(['document', documentId], (old) =>
                old ? { ...old, ocr_status: 'pending' } : old,
            );
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
        mutationFn: ({ documentId, file }: { documentId: string; file: File }) =>
            documentsApi.replaceFile(documentId, file),
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
            await queryClient.cancelQueries({ queryKey: ['sections', 'tree'] });
            const previous = queryClient.getQueriesData({ queryKey: ['documents'] });
            const previousSections = queryClient.getQueryData<FolderWithChildren[]>(['sections', 'tree']);

            queryClient.setQueriesData({ queryKey: ['documents'] }, (old: DocumentsResponse | InfiniteData<DocumentsResponse> | undefined) => {
                if (!old) return old;

                const infinite = old as { pages?: DocumentsResponse[]; pageParams?: unknown[] };

                if (infinite.pages) {
                    const pages = infinite.pages.map((page) => ({
                        ...page,
                        items: page.items.filter((d) => !ids.includes(d.id)),
                    }));

                    if (pages[0]) {
                        pages[0].total = Math.max(0, (infinite.pages[0]?.total ?? 0) - ids.length);
                    }

                    return { ...infinite, pages };
                }

                const single = old as DocumentsResponse;

                return {
                    ...single,
                    items: single.items.filter((d) => !ids.includes(d.id)),
                    total: single.total - ids.length,
                };
            });

            if (previousSections) {
                const decrements = new Map<string, number>();

                for (const [, data] of previous) {
                    const res = data as DocumentsResponse | InfiniteData<DocumentsResponse> | undefined;
                    const items = !res
                        ? []
                        : 'pages' in res && Array.isArray(res.pages)
                          ? (res as InfiniteData<DocumentsResponse>).pages.flatMap((p) => p.items)
                          : ((res as DocumentsResponse).items ?? []);

                    for (const id of ids) {
                        const doc = items.find((d) => d.id === id);
                        const fid = doc?.folder_id ?? null;

                        if (fid) decrements.set(fid, (decrements.get(fid) ?? 0) + 1);
                    }
                }

                if (decrements.size > 0) {
                    const decrementFolderCount = (nodes: FolderWithChildren[]): FolderWithChildren[] =>
                        nodes.map((node) => ({
                            ...node,
                            document_count: Math.max(0, node.document_count - (decrements.get(node.id) ?? 0)),
                            children: decrementFolderCount(node.children),
                        }));
                    queryClient.setQueryData(['sections', 'tree'], decrementFolderCount(previousSections));
                }
            }

            return { previous, previousSections };
        },
        onSuccess: (_, ids) => {
            toast.success(ids.length === 1 ? 'Document deleted' : `${ids.length} documents deleted`);
        },
        onError: (_, __, context) => {
            if (context?.previous) {
                context.previous.forEach(([queryKey, data]) => {
                    queryClient.setQueryData(queryKey, data);
                });
            }

            if (context?.previousSections != null) {
                queryClient.setQueryData(['sections', 'tree'], context.previousSections);
            }

            toast.error('Failed to delete documents');
        },
        onSettled: (_, __, ids) => {
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['user'] });
            ids.forEach((id) => queryClient.removeQueries({ queryKey: ['document', id] }));
        },
    });
}

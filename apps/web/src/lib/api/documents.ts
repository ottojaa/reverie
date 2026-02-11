import { type Document, type FolderWithChildren } from '@reverie/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAuth, useAuthenticatedFetch } from '../auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface DocumentsResponse {
    items: Document[];
    total: number;
    limit: number;
    offset: number;
}

interface UseDocumentsOptions {
    folderId?: string | null;
    limit?: number;
    offset?: number;
}

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

export interface CheckDuplicatesResult {
    duplicates: string[];
}

export async function checkDuplicates(
    authFetch: AuthFetch,
    folderId: string,
    filenames: string[],
): Promise<CheckDuplicatesResult> {
    if (filenames.length === 0) return { duplicates: [] };

    const response = await authFetch(`${API_BASE}/documents/check-duplicates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folder_id: folderId, filenames }),
    });

    if (!response.ok) throw new Error('Failed to check duplicates');

    return response.json();
}

async function fetchDocumentsWithAuth(authFetch: AuthFetch, options: UseDocumentsOptions = {}): Promise<DocumentsResponse> {
    const params = new URLSearchParams();

    if (options.folderId) params.set('folder_id', options.folderId);

    if (options.limit) params.set('limit', String(options.limit));

    if (options.offset !== undefined && options.offset > 0) params.set('offset', String(options.offset));

    const url = `${API_BASE}/documents${params.toString() ? `?${params}` : ''}`;
    const response = await authFetch(url, { credentials: 'include' });

    if (!response.ok) throw new Error('Failed to fetch documents');

    return response.json();
}

/**
 * Hook to fetch documents (uses auth fetch so 401 triggers refresh + retry)
 */
export function useDocuments(options: UseDocumentsOptions = {}) {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    return useQuery({
        queryKey: ['documents', options],
        queryFn: () => fetchDocumentsWithAuth(authFetch, options),
        enabled: isAuthenticated,
    });
}

const DEFAULT_PAGE_SIZE = 24;

/**
 * Infinite scroll documents (offset-based pagination, use in Browse)
 */
export function useInfiniteDocuments(options: UseDocumentsOptions = {}) {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    const stableOptions = {
        folderId: options.folderId ?? null,
        limit: options.limit ?? DEFAULT_PAGE_SIZE,
    };

    return useInfiniteQuery({
        queryKey: ['documents', 'infinite', stableOptions],
        queryFn: ({ pageParam }) =>
            fetchDocumentsWithAuth(authFetch, {
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
    const authFetch = useAuthenticatedFetch();

    return useCallback(
        (folderId: string | null | undefined) => {
            const options = { limit: 50, ...(folderId && { folderId }) };
            queryClient.prefetchQuery({
                queryKey: ['documents', options],
                queryFn: () => fetchDocumentsWithAuth(authFetch, options),
            });
        },
        [queryClient, authFetch],
    );
}

async function fetchDocumentWithAuth(authFetch: AuthFetch, documentId: string): Promise<Document> {
    const response = await authFetch(`${API_BASE}/documents/${documentId}`, { credentials: 'include' });

    if (!response.ok) throw new Error('Failed to fetch document');

    return response.json();
}

/**
 * Hook to fetch a single document (uses auth fetch for 401 refresh + retry)
 */
export function useDocument(documentId: string) {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    return useQuery({
        queryKey: ['document', documentId],
        queryFn: () => fetchDocumentWithAuth(authFetch, documentId),
        enabled: isAuthenticated && !!documentId,
    });
}

async function deleteDocumentsWithAuth(authFetch: AuthFetch, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    if (ids.length === 1) {
        const response = await authFetch(`${API_BASE}/documents/${ids[0]}`, {
            method: 'DELETE',
            credentials: 'include',
        });

        if (!response.ok) throw new Error('Failed to delete document');

        return;
    }

    const response = await authFetch(`${API_BASE}/documents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
    });

    if (!response.ok) throw new Error('Failed to delete documents');
}

/**
 * Hook to delete documents with optimistic updates (uses auth fetch for 401 refresh + retry)
 */
export function useDeleteDocuments() {
    const queryClient = useQueryClient();
    const authFetch = useAuthenticatedFetch();

    return useMutation({
        mutationFn: (ids: string[]) => deleteDocumentsWithAuth(authFetch, ids),
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
                          : (res as DocumentsResponse).items ?? [];

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
            ids.forEach((id) => queryClient.removeQueries({ queryKey: ['document', id] }));
        },
    });
}

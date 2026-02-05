import type { Document } from '@reverie/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
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

async function fetchDocumentsWithAuth(
    authFetch: AuthFetch,
    options: UseDocumentsOptions = {},
): Promise<DocumentsResponse> {
    const params = new URLSearchParams();
    if (options.folderId) params.set('folder_id', options.folderId);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
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
            const previous = queryClient.getQueriesData({ queryKey: ['documents'] });
            queryClient.setQueriesData({ queryKey: ['documents'] }, (old: DocumentsResponse | undefined) => {
                if (!old) return old;
                return {
                    ...old,
                    items: old.items.filter((d) => !ids.includes(d.id)),
                    total: old.total - ids.length,
                };
            });
            return { previous };
        },
        onSuccess: (_, ids) => {
            toast.success(
                ids.length === 1 ? 'Document deleted' : `${ids.length} documents deleted`,
            );
        },
        onError: (_, __, context) => {
            if (context?.previous) {
                context.previous.forEach(([queryKey, data]) => {
                    queryClient.setQueryData(queryKey, data);
                });
            }
            toast.error('Failed to delete documents');
        },
        onSettled: (_, __, ids) => {
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            ids.forEach((id) => queryClient.removeQueries({ queryKey: ['document', id] }));
        },
    });
}

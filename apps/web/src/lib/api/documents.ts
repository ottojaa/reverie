import { useQuery } from '@tanstack/react-query';
import type { Document } from '@reverie/shared';
import { useAuth } from '../auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface DocumentsResponse {
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

/**
 * Fetch documents from the API
 */
async function fetchDocuments(
    accessToken: string,
    options: UseDocumentsOptions = {},
): Promise<DocumentsResponse> {
    const params = new URLSearchParams();

    if (options.folderId) {
        params.set('folder_id', options.folderId);
    }
    if (options.limit) {
        params.set('limit', String(options.limit));
    }
    if (options.offset) {
        params.set('offset', String(options.offset));
    }

    const url = `${API_BASE}/documents${params.toString() ? `?${params}` : ''}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error('Failed to fetch documents');
    }

    return response.json();
}

/**
 * Hook to fetch documents
 */
export function useDocuments(options: UseDocumentsOptions = {}) {
    const { accessToken, isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['documents', options],
        queryFn: () => fetchDocuments(accessToken!, options),
        enabled: isAuthenticated && !!accessToken,
    });
}

/**
 * Fetch a single document
 */
async function fetchDocument(accessToken: string, documentId: string): Promise<Document> {
    const response = await fetch(`${API_BASE}/documents/${documentId}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error('Failed to fetch document');
    }

    return response.json();
}

/**
 * Hook to fetch a single document
 */
export function useDocument(documentId: string) {
    const { accessToken, isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['document', documentId],
        queryFn: () => fetchDocument(accessToken!, documentId),
        enabled: isAuthenticated && !!accessToken && !!documentId,
    });
}

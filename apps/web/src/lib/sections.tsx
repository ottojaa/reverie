import type { Folder, FolderWithChildren } from '@reverie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { produce } from 'immer';
import { toast } from 'sonner';
import type { DocumentsResponse } from './api/documents';
import { useAuth, useAuthenticatedFetch } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** Droppable id prefix for folder drop zones (sidebar sections). Parse folder id as overId.slice(prefix.length). */
export const FOLDER_DROP_PREFIX = 'folder-';

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

async function fetchSectionTreeWithAuth(authFetch: AuthFetch): Promise<FolderWithChildren[]> {
    const response = await authFetch(`${API_BASE}/folders/tree`, { credentials: 'include' });

    if (!response.ok) throw new Error('Failed to fetch sections');

    return response.json();
}

/**
 * Flatten tree to find section by id
 */
export function findSectionById(tree: FolderWithChildren[], id: string | null): FolderWithChildren | null {
    if (!id) return null;

    for (const node of tree) {
        if (node.id === id) return node;

        const found = findSectionById(node.children, id);

        if (found) return found;
    }

    return null;
}

/**
 * Build a map of folder id -> parent_id (null for root). Used to detect parent changes on reorder.
 */
export function sectionsToParentMap(tree: FolderWithChildren[]): Map<string, string | null> {
    const map = new Map<string, string | null>();

    function walk(nodes: FolderWithChildren[], parentId: string | null) {
        for (const node of nodes) {
            map.set(node.id, parentId);
            walk(node.children, node.id);
        }
    }

    walk(tree, null);

    return map;
}

/**
 * Flatten tree to ordered list (depth-first) for sortable ids
 */
export function flattenSectionTree(tree: FolderWithChildren[]): FolderWithChildren[] {
    const out: FolderWithChildren[] = [];

    function walk(nodes: FolderWithChildren[]) {
        for (const n of nodes) {
            out.push(n);
            walk(n.children);
        }
    }

    walk(tree);

    return out;
}

/**
 * Deep clone the tree and apply sort order updates to siblings
 */
function applyReorderToTree(tree: FolderWithChildren[], updates: Array<{ id: string; sort_order: number }>): FolderWithChildren[] {
    const updateMap = new Map(updates.map((u) => [u.id, u.sort_order]));

    return produce(tree, (draft) => {
        function processNodes(nodes: FolderWithChildren[]) {
            const needsSort = nodes.some((n) => updateMap.has(n.id));
            nodes.forEach((node) => processNodes(node.children));

            if (!needsSort) return;

            nodes.sort((a, b) => {
                const orderA = updateMap.get(a.id) ?? a.sort_order;
                const orderB = updateMap.get(b.id) ?? b.sort_order;

                return orderA - orderB;
            });
        }

        processNodes(draft);
    });
}

/**
 * Patch a folder's properties (name, description, emoji) in the tree
 */
function patchFolderInTree(
    tree: FolderWithChildren[],
    folderId: string,
    patch: { name?: string; description?: string | null; emoji?: string | null },
): FolderWithChildren[] {
    return produce(tree, (draft) => {
        function walk(nodes: FolderWithChildren[]) {
            for (const node of nodes) {
                if (node.id === folderId) {
                    if (patch.name !== undefined) node.name = patch.name;

                    if (patch.description !== undefined) node.description = patch.description;

                    if (patch.emoji !== undefined) node.emoji = patch.emoji;

                    return;
                }

                walk(node.children);
            }
        }

        walk(draft);
    });
}

/**
 * Move a section to a new parent in the tree
 */
export function moveSectionInTree(tree: FolderWithChildren[], sectionId: string, newParentId: string | null): FolderWithChildren[] {
    let movedSection: FolderWithChildren | null = null;
    const treeWithoutSection = produce(tree, (draft) => {
        function remove(nodes: FolderWithChildren[]): boolean {
            const idx = nodes.findIndex((n) => n.id === sectionId);

            if (idx !== -1) {
                movedSection = nodes[idx] as FolderWithChildren;
                nodes.splice(idx, 1);

                return true;
            }

            for (const node of nodes) {
                if (remove(node.children)) return true;
            }

            return false;
        }

        remove(draft);
    });

    if (!movedSection) return tree;

    const updatedSection: FolderWithChildren = { ...(movedSection as FolderWithChildren), parent_id: newParentId };

    return produce(treeWithoutSection, (draft) => {
        if (newParentId === null) {
            draft.push(updatedSection);

            return;
        }

        function addToParent(nodes: FolderWithChildren[]): boolean {
            const target = nodes.find((n) => n.id === newParentId);

            if (target) {
                target.children.push(updatedSection);

                return true;
            }

            for (const node of nodes) {
                if (addToParent(node.children)) return true;
            }

            return false;
        }

        addToParent(draft);
    });
}

export function useSections() {
    const { isAuthenticated } = useAuth();
    const authFetch = useAuthenticatedFetch();

    return useQuery({
        queryKey: ['sections', 'tree'],
        queryFn: () => fetchSectionTreeWithAuth(authFetch),
        enabled: isAuthenticated,
        staleTime: 5 * 60 * 1000,
    });
}

/**
 * Resolve current section from route sectionId param and section tree
 */
export function useCurrentSection(sectionId: string | undefined) {
    const { data: tree } = useSections();

    if (!tree || !sectionId) return null;

    return findSectionById(tree, sectionId);
}

async function reorderSectionsWithAuth(authFetch: AuthFetch, updates: Array<{ id: string; sort_order: number }>): Promise<void> {
    const response = await authFetch(`${API_BASE}/folders/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates }),
    });

    if (!response.ok) throw new Error('Failed to reorder sections');
}

async function moveDocumentsWithAuth(authFetch: AuthFetch, data: { document_ids: string[]; folder_id: string }): Promise<void> {
    const response = await authFetch(`${API_BASE}/documents/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error('Failed to move documents');
}

export function useReorderSections() {
    const queryClient = useQueryClient();
    const authFetch = useAuthenticatedFetch();

    return useMutation({
        mutationFn: (updates: Array<{ id: string; sort_order: number }>) => reorderSectionsWithAuth(authFetch, updates),
        onMutate: async (updates) => {
            await queryClient.cancelQueries({ queryKey: ['sections', 'tree'] });
            const previous = queryClient.getQueryData<FolderWithChildren[]>(['sections', 'tree']);

            if (previous) {
                const optimistic = applyReorderToTree(previous, updates);
                queryClient.setQueryData(['sections', 'tree'], optimistic);
            }

            return { previous };
        },
        onError: (_, __, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['sections', 'tree'], context.previous);
            }

            toast.error('Failed to reorder sections');
        },
        // Don't invalidate on success: refetch can return stale order and overwrite optimistic UI
    });
}

async function createFolderWithAuth(
    authFetch: AuthFetch,
    data: { name: string; parent_id?: string; description?: string; emoji?: string; type?: 'category' | 'section' },
): Promise<Folder> {
    const response = await authFetch(`${API_BASE}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error('Failed to create section');

    return response.json();
}

async function updateFolderWithAuth(
    authFetch: AuthFetch,
    id: string,
    data: { name?: string; description?: string | null; emoji?: string | null; parent_id?: string | null },
): Promise<Folder> {
    const response = await authFetch(`${API_BASE}/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error('Failed to update section');

    return response.json();
}

async function deleteFolderWithAuth(authFetch: AuthFetch, id: string): Promise<void> {
    const response = await authFetch(`${API_BASE}/folders/${id}`, {
        method: 'DELETE',
        credentials: 'include',
    });

    if (!response.ok) throw new Error('Failed to delete section');
}

export function useCreateFolder() {
    const queryClient = useQueryClient();
    const authFetch = useAuthenticatedFetch();

    return useMutation({
        mutationFn: (data: { name: string; parent_id?: string; description?: string; emoji?: string; type?: 'category' | 'section' }) =>
            createFolderWithAuth(authFetch, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
        onError: () => toast.error('Failed to create section'),
    });
}

export function useCreateCategory() {
    const createFolder = useCreateFolder();

    return {
        ...createFolder,
        mutate: (data: { name: string; description?: string; emoji?: string }, options?: Parameters<typeof createFolder.mutate>[1]) =>
            createFolder.mutate({ ...data, type: 'category' as const }, options),
    };
}

export function useUpdateFolder() {
    const queryClient = useQueryClient();
    const authFetch = useAuthenticatedFetch();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string | null; emoji?: string | null; parent_id?: string | null } }) =>
            updateFolderWithAuth(authFetch, id, data),
        onMutate: async ({ id, data }) => {
            const hasOrderChange = data.parent_id !== undefined;
            const hasMetadataChange = data.name !== undefined || data.description !== undefined || data.emoji !== undefined;

            if (!hasOrderChange && !hasMetadataChange) return;

            await queryClient.cancelQueries({ queryKey: ['sections', 'tree'] });
            const previous = queryClient.getQueryData<FolderWithChildren[]>(['sections', 'tree']);

            if (!previous) return { previous };

            function applyOptimisticUpdate(tree: FolderWithChildren[]): FolderWithChildren[] {
                let result = tree;

                if (hasOrderChange) {
                    result = moveSectionInTree(result, id, data.parent_id ?? null);
                }

                if (hasMetadataChange) {
                    result = patchFolderInTree(result, id, {
                        ...(data.name !== undefined && { name: data.name }),
                        ...(data.description !== undefined && { description: data.description }),
                        ...(data.emoji !== undefined && { emoji: data.emoji }),
                    });
                }

                return result;
            }

            const optimistic = applyOptimisticUpdate(previous);
            queryClient.setQueryData(['sections', 'tree'], optimistic);

            return { previous };
        },
        onError: (_, __, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['sections', 'tree'], context.previous);
            }

            toast.error('Failed to update section');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
    });
}

export function useDeleteFolder() {
    const queryClient = useQueryClient();
    const authFetch = useAuthenticatedFetch();

    return useMutation({
        mutationFn: (id: string) => deleteFolderWithAuth(authFetch, id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
        onError: () => toast.error('Failed to delete section'),
    });
}

export function useMoveDocuments() {
    const queryClient = useQueryClient();
    const authFetch = useAuthenticatedFetch();

    return useMutation({
        mutationFn: (data: { document_ids: string[]; folder_id: string }) => moveDocumentsWithAuth(authFetch, data),
        onMutate: async ({ document_ids, folder_id }) => {
            await queryClient.cancelQueries({ queryKey: ['documents'] });
            const previous = queryClient.getQueriesData<DocumentsResponse>({ queryKey: ['documents'] });
            queryClient.setQueriesData({ queryKey: ['documents'] }, (old: DocumentsResponse | undefined) => {
                if (!old) return old;

                return {
                    ...old,
                    items: old.items.map((doc) => (document_ids.includes(doc.id) ? { ...doc, folder_id } : doc)),
                };
            });

            return { previous };
        },
        onError: (_, __, context) => {
            if (context?.previous) {
                context.previous.forEach(([queryKey, data]) => {
                    queryClient.setQueryData(queryKey, data);
                });
            }

            toast.error('Failed to move documents');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
    });
}

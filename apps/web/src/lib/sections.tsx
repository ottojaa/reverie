import type { FolderWithChildren } from '@reverie/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { produce } from 'immer';
import { toast } from 'sonner';
import type { DocumentsResponse } from './api/documents';
import { documentsApi } from './api/documents';
import { foldersApi } from './api/folders';
import { useAuth } from './auth';

/** Droppable id prefix for folder drop zones (sidebar sections). Parse folder id as overId.slice(prefix.length). */
export const FOLDER_DROP_PREFIX = 'folder-';

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
    return produce(tree, (draft) => {
        function remove(nodes: FolderWithChildren[]): FolderWithChildren | null {
            const idx = nodes.findIndex((n) => n.id === sectionId);

            if (idx !== -1) {
                const [removed] = nodes.splice(idx, 1);

                return removed ?? null;
            }

            for (const node of nodes) {
                const found = remove(node.children);

                if (found) return found;
            }

            return null;
        }

        const movedSection = remove(draft);

        if (!movedSection) return;

        movedSection.parent_id = newParentId;

        if (newParentId === null) {
            draft.push(movedSection);

            return;
        }

        function addToParent(nodes: FolderWithChildren[], section: FolderWithChildren): boolean {
            const target = nodes.find((n) => n.id === newParentId);

            if (target) {
                target.children.push(section);

                return true;
            }

            for (const node of nodes) {
                if (addToParent(node.children, section)) return true;
            }

            return false;
        }

        addToParent(draft, movedSection);
    });
}

export function useSections() {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['sections', 'tree'],
        queryFn: () => foldersApi.getTree(),
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

export interface MoveDocumentsParams {
    document_ids: string[];
    folder_id: string;
    conflict_strategy?: 'replace' | 'keep_both';
}

export function useReorderFolders() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (updates: Array<{ id: string; sort_order: number }>) => foldersApi.reorder(updates),
        onMutate: async (updates) => {
            await queryClient.cancelQueries({ queryKey: ['sections', 'tree'] });
            const previous = queryClient.getQueryData<FolderWithChildren[]>(['sections', 'tree']);

            if (!previous) return { previous };

            const optimistic = applyReorderToTree(previous, updates);
            queryClient.setQueryData(['sections', 'tree'], optimistic);

            return { previous };
        },
        onError: (_, __, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['sections', 'tree'], context.previous);
            }

            toast.error('Failed to reorder folders');
        },
        // Don't invalidate on success: refetch can return stale order and overwrite optimistic UI
    });
}

export function useCreateFolder() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: { name: string; parent_id?: string; description?: string; emoji?: string; type?: 'collection' | 'folder' }) =>
            foldersApi.create(data),
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
            createFolder.mutate({ ...data, type: 'collection' as const }, options),
    };
}

export function useUpdateFolder() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string | null; emoji?: string | null; parent_id?: string | null } }) =>
            foldersApi.patch(id, data),
        onMutate: async ({ id, data }) => {
            const { parent_id, ...patch } = data;

            const transforms: Array<(tree: FolderWithChildren[]) => FolderWithChildren[]> = [];

            if (parent_id !== undefined) transforms.push((t) => moveSectionInTree(t, id, parent_id ?? null));

            if (Object.values(patch).some((v) => v !== undefined)) transforms.push((t) => patchFolderInTree(t, id, patch));

            if (transforms.length === 0) return;

            await queryClient.cancelQueries({ queryKey: ['sections', 'tree'] });
            const previous = queryClient.getQueryData<FolderWithChildren[]>(['sections', 'tree']);

            if (!previous) return { previous };

            queryClient.setQueryData(['sections', 'tree'], transforms.reduce((tree, fn) => fn(tree), previous));

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

    return useMutation({
        mutationFn: (id: string) => foldersApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
        onError: () => toast.error('Failed to delete section'),
    });
}

export function useMoveDocuments() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: MoveDocumentsParams) => documentsApi.move(data),
        onMutate: async ({ document_ids, folder_id }) => {
            await queryClient.cancelQueries({ queryKey: ['documents'] });
            const previous = queryClient.getQueriesData<DocumentsResponse | InfiniteData<DocumentsResponse>>({ queryKey: ['documents'] });
            queryClient.setQueriesData({ queryKey: ['documents'] }, (old: DocumentsResponse | InfiniteData<DocumentsResponse> | undefined) => {
                if (!old) return old;

                const infinite = old as { pages?: DocumentsResponse[] };

                if (infinite.pages) {
                    return produce(old as InfiniteData<DocumentsResponse>, (draft) => {
                        for (const page of draft.pages) {
                            for (const doc of page.items) {
                                if (document_ids.includes(doc.id)) doc.folder_id = folder_id;
                            }
                        }
                    });
                }

                return produce(old as DocumentsResponse, (draft) => {
                    for (const doc of draft.items) {
                        if (document_ids.includes(doc.id)) doc.folder_id = folder_id;
                    }
                });
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

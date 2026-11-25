import type { CreateFolderRequest, FolderWithChildren, UpdateFolderRequest } from '@reverie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getApiErrorMessage } from './api/client';
import { withDocumentsMoved } from './api/document-cache';
import { documentsApi } from './api/documents';
import { foldersApi } from './api/folders';
import { useAuth } from './auth';
import { moveInTree, patchInTree, reorderTree } from './folders/tree-edits';
import { findFolder } from './folders/tree';
import { runUnlocking } from './folders/with-unlock';
import { useVault } from './vault';

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

    return findFolder(tree ?? [], sectionId);
}

export interface MoveDocumentsParams {
    document_ids: string[];
    /** Null moves the documents to the top level. */
    folder_id: string | null;
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

            const optimistic = reorderTree(previous, updates);
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
    const { requestUnlock } = useVault();

    return useMutation({
        mutationFn: (data: Omit<CreateFolderRequest, 'type'>) => runUnlocking(() => foldersApi.create(data), requestUnlock),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to create section')),
    });
}

export function useUpdateFolder() {
    const queryClient = useQueryClient();
    const { requestUnlock } = useVault();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateFolderRequest }) => runUnlocking(() => foldersApi.patch(id, data), requestUnlock),
        onMutate: async ({ id, data }) => {
            const { parent_id, ...patch } = data;

            const transforms: Array<(tree: FolderWithChildren[]) => FolderWithChildren[]> = [];

            if (parent_id !== undefined) transforms.push((t) => moveInTree(t, id, parent_id));

            if (Object.values(patch).some((v) => v !== undefined)) transforms.push((t) => patchInTree(t, id, patch));

            if (transforms.length === 0) return;

            await queryClient.cancelQueries({ queryKey: ['sections', 'tree'] });
            const previous = queryClient.getQueryData<FolderWithChildren[]>(['sections', 'tree']);

            if (!previous) return { previous };

            queryClient.setQueryData(
                ['sections', 'tree'],
                transforms.reduce((tree, fn) => fn(tree), previous),
            );

            return { previous };
        },
        onError: (error, __, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['sections', 'tree'], context.previous);
            }

            toast.error(getApiErrorMessage(error, 'Failed to update section'));
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
    });
}

export function useDeleteFolder() {
    const queryClient = useQueryClient();
    const { requestUnlock } = useVault();

    return useMutation({
        mutationFn: (id: string) => runUnlocking(() => foldersApi.delete(id), requestUnlock),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sections'] });
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['trash'] });
        },
        onError: () => toast.error('Failed to delete section'),
    });
}

export function useMoveDocuments() {
    const queryClient = useQueryClient();
    const { requestUnlock } = useVault();

    return useMutation({
        mutationFn: (data: MoveDocumentsParams) => runUnlocking(() => documentsApi.move(data), requestUnlock),
        onMutate: async ({ document_ids, folder_id }) => {
            await queryClient.cancelQueries({ queryKey: ['documents'] });
            const previous = queryClient.getQueriesData({ queryKey: ['documents'] });
            queryClient.setQueriesData({ queryKey: ['documents'] }, (old) => (old ? withDocumentsMoved(old, document_ids, folder_id) : old));

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
            queryClient.invalidateQueries({ queryKey: ['search'] });
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
    });
}

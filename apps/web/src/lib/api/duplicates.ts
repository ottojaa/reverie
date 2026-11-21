import {
    DismissDuplicatesResponseSchema,
    DuplicatesResponseSchema,
    TrashOthersResponseSchema,
    type DismissDuplicatesResponse,
    type DuplicatesResponse,
    type TrashOthersResponse,
} from '@reverie/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '../auth';
import { apiClient, getApiErrorMessage } from './client';
import { useRestoreFromTrash } from './trash';

export interface GroupChoice {
    group_id: string;
    keep_id: string;
}

export const duplicatesApi = {
    async list(folderId?: string): Promise<DuplicatesResponse> {
        const { data } = await apiClient.get('/duplicates', { params: { folder_id: folderId } });

        return DuplicatesResponseSchema.parse(data);
    },

    async trashOthers(groups: GroupChoice[], folderId?: string): Promise<TrashOthersResponse> {
        const { data } = await apiClient.post('/duplicates/trash-others', { folder_id: folderId, groups });

        return TrashOthersResponseSchema.parse(data);
    },

    async dismiss(groupId: string, folderId?: string): Promise<DismissDuplicatesResponse> {
        const { data } = await apiClient.post('/duplicates/dismiss', { folder_id: folderId, group_id: groupId });

        return DismissDuplicatesResponseSchema.parse(data);
    },
};

export const DUPLICATES_QUERY_KEY = ['duplicates'] as const;

export function useDuplicates(folderId?: string) {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: [...DUPLICATES_QUERY_KEY, folderId ?? null],
        queryFn: () => duplicatesApi.list(folderId),
        enabled: isAuthenticated,
    });
}

/** Trashing or restoring images changes the listings, folder counts, the tree, search, the Trash and the groups. */
function invalidateLibrary(queryClient: QueryClient) {
    for (const key of [DUPLICATES_QUERY_KEY, ['documents'], ['sections'], ['search'], ['trash'], ['user']]) {
        queryClient.invalidateQueries({ queryKey: key });
    }
}

function describeTrashed(result: TrashOthersResponse): string {
    const n = result.trashed_ids.length;

    return n === 0 ? 'Nothing was moved: the groups changed' : `${n} ${n === 1 ? 'image' : 'images'} moved to Trash`;
}

/** Moves the other copies of each group to the Trash and offers an undo, which restores them from the Trash. */
export function useTrashOthers(folderId?: string) {
    const queryClient = useQueryClient();
    const restore = useRestoreFromTrash();

    return useMutation({
        mutationFn: (groups: GroupChoice[]) => duplicatesApi.trashOthers(groups, folderId),
        onSuccess: (result) => {
            const message = describeTrashed(result);

            if (result.trashed_ids.length === 0) {
                toast.warning(message);

                return;
            }

            toast.success(message, {
                duration: 10_000,
                action: {
                    label: 'Undo',
                    onClick: () => restore.mutate({ document_ids: result.trashed_ids, folder_ids: [] }, { onSettled: () => invalidateLibrary(queryClient) }),
                },
            });
        },
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to move images to Trash')),
        onSettled: () => invalidateLibrary(queryClient),
    });
}

export function useDismissDuplicates(folderId?: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (groupId: string) => duplicatesApi.dismiss(groupId, folderId),
        onSuccess: () => toast.success('Marked as not duplicates'),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to dismiss this group')),
        onSettled: () => queryClient.invalidateQueries({ queryKey: DUPLICATES_QUERY_KEY }),
    });
}

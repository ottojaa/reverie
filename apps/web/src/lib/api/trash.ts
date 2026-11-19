import { TrashListResponseSchema, TrashResultSchema, type TrashListResponse, type TrashResult } from '@reverie/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '../auth';
import { apiClient, getApiErrorMessage } from './client';

export interface TrashSelection {
    document_ids: string[];
    folder_ids: string[];
}

export const trashApi = {
    async list(): Promise<TrashListResponse> {
        const { data } = await apiClient.get('/trash');

        return TrashListResponseSchema.parse(data);
    },

    async restore(selection: TrashSelection): Promise<TrashResult> {
        const { data } = await apiClient.post('/trash/restore', selection);

        return TrashResultSchema.parse(data);
    },

    async purge(selection: TrashSelection): Promise<TrashResult> {
        const { data } = await apiClient.post('/trash/purge', selection);

        return TrashResultSchema.parse(data);
    },

    async empty(): Promise<TrashResult> {
        const { data } = await apiClient.delete('/trash');

        return TrashResultSchema.parse(data);
    },
};

export const TRASH_QUERY_KEY = ['trash'] as const;

export function useTrash() {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: TRASH_QUERY_KEY,
        queryFn: () => trashApi.list(),
        enabled: isAuthenticated,
    });
}

function describeResult(result: TrashResult, verb: string): string {
    const parts = [
        result.documents > 0 ? `${result.documents} document${result.documents === 1 ? '' : 's'}` : null,
        result.folders > 0 ? `${result.folders} folder${result.folders === 1 ? '' : 's'}` : null,
    ].filter((part): part is string => part !== null);

    return parts.length === 0 ? 'Nothing changed' : `${parts.join(' and ')} ${verb}`;
}

function invalidateAfterChange(queryClient: QueryClient, { alsoLibrary }: { alsoLibrary: boolean }) {
    queryClient.invalidateQueries({ queryKey: TRASH_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['user'] });

    if (!alsoLibrary) return;

    // A restored item reappears in listings, folder counts, the tree and search.
    queryClient.invalidateQueries({ queryKey: ['documents'] });
    queryClient.invalidateQueries({ queryKey: ['sections'] });
    queryClient.invalidateQueries({ queryKey: ['search'] });
}

export function useRestoreFromTrash() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (selection: TrashSelection) => trashApi.restore(selection),
        onSuccess: (result) => toast.success(describeResult(result, 'restored')),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to restore')),
        onSettled: () => invalidateAfterChange(queryClient, { alsoLibrary: true }),
    });
}

export function usePurgeFromTrash() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (selection: TrashSelection) => trashApi.purge(selection),
        onSuccess: (result) => toast.success(describeResult(result, 'deleted forever')),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to delete')),
        onSettled: () => invalidateAfterChange(queryClient, { alsoLibrary: false }),
    });
}

export function useEmptyTrash() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => trashApi.empty(),
        onSuccess: (result) => toast.success(describeResult(result, 'deleted forever')),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to empty trash')),
        onSettled: () => invalidateAfterChange(queryClient, { alsoLibrary: false }),
    });
}

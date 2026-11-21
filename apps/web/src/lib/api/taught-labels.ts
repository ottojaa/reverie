import {
    TaughtLabelDetailResponseSchema,
    TaughtLabelListResponseSchema,
    TaughtLabelSchema,
    TaughtLabelSimilaritiesResponseSchema,
    TeachLabelResponseSchema,
    type TaughtLabel,
    type TaughtLabelDetailResponse,
    type TaughtLabelSimilaritiesResponse,
    type TeachLabelRequest,
    type TeachLabelResponse,
} from '@reverie/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { apiClient } from './client';

/** A page of matches shown in the manager. */
export const MATCHES_PAGE_SIZE = 60;

export const taughtLabelsApi = {
    async list(): Promise<TaughtLabel[]> {
        const { data } = await apiClient.get('/taught-labels');

        return TaughtLabelListResponseSchema.parse(data).labels;
    },

    async teach(request: TeachLabelRequest): Promise<TeachLabelResponse> {
        const { data } = await apiClient.post('/taught-labels', request);

        return TeachLabelResponseSchema.parse(data);
    },

    async get(id: string, limit: number): Promise<TaughtLabelDetailResponse> {
        const { data } = await apiClient.get(`/taught-labels/${id}`, { params: { limit, offset: 0 } });

        return TaughtLabelDetailResponseSchema.parse(data);
    },

    async getSimilarities(id: string): Promise<TaughtLabelSimilaritiesResponse> {
        const { data } = await apiClient.get(`/taught-labels/${id}/similarities`);

        return TaughtLabelSimilaritiesResponseSchema.parse(data);
    },

    async setThreshold(id: string, threshold: number): Promise<TaughtLabel> {
        const { data } = await apiClient.patch(`/taught-labels/${id}`, { threshold });

        return TaughtLabelSchema.parse(data);
    },

    async removeExample(id: string, documentId: string): Promise<void> {
        await apiClient.delete(`/taught-labels/${id}/examples/${documentId}`);
    },

    async removeMatch(id: string, documentId: string): Promise<void> {
        await apiClient.delete(`/taught-labels/${id}/matches/${documentId}`);
    },

    async remove(id: string): Promise<void> {
        await apiClient.delete(`/taught-labels/${id}`);
    },
};

/** Labels change what documents, search results and facets show, so every mutation refreshes all of them. */
function invalidateEverythingATagTouches(queryClient: QueryClient) {
    for (const key of ['taught-labels', 'document', 'documents', 'search']) queryClient.invalidateQueries({ queryKey: [key] });
}

export function useTaughtLabels(enabled = true) {
    const { isAuthenticated } = useAuth();

    return useQuery({ queryKey: ['taught-labels'], queryFn: taughtLabelsApi.list, enabled: isAuthenticated && enabled });
}

export function useTaughtLabel(id: string | null) {
    return useQuery({
        queryKey: ['taught-labels', 'detail', id],
        queryFn: () => taughtLabelsApi.get(id!, MATCHES_PAGE_SIZE),
        enabled: id !== null,
    });
}

export function useTaughtLabelSimilarities(id: string | null) {
    return useQuery({
        queryKey: ['taught-labels', 'similarities', id],
        queryFn: () => taughtLabelsApi.getSimilarities(id!),
        enabled: id !== null,
    });
}

export function useTeachLabel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: TeachLabelRequest) => taughtLabelsApi.teach(request),
        onSuccess: () => invalidateEverythingATagTouches(queryClient),
    });
}

export function useSetLabelThreshold() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, threshold }: { id: string; threshold: number }) => taughtLabelsApi.setThreshold(id, threshold),
        onSuccess: () => invalidateEverythingATagTouches(queryClient),
    });
}

export function useRemoveLabelExample() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, documentId }: { id: string; documentId: string }) => taughtLabelsApi.removeExample(id, documentId),
        onSuccess: () => invalidateEverythingATagTouches(queryClient),
    });
}

/** Taking a taught tag off an image keeps the label from coming back to it. */
export function useRemoveLabelMatch() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, documentId }: { id: string; documentId: string }) => taughtLabelsApi.removeMatch(id, documentId),
        onSuccess: () => invalidateEverythingATagTouches(queryClient),
    });
}

export function useDeleteLabel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => taughtLabelsApi.remove(id),
        onSuccess: () => invalidateEverythingATagTouches(queryClient),
    });
}

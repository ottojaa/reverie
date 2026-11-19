import { CreateApiTokenResponseSchema, ListApiTokensResponseSchema, type CreateApiTokenResponse, type ListApiTokensResponse } from '@reverie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '../auth';
import { apiClient, getApiErrorMessage } from './client';

export const apiTokensApi = {
    async list(): Promise<ListApiTokensResponse> {
        const { data } = await apiClient.get('/api-tokens');

        return ListApiTokensResponseSchema.parse(data);
    },

    async create(name: string): Promise<CreateApiTokenResponse> {
        const { data } = await apiClient.post('/api-tokens', { name });

        return CreateApiTokenResponseSchema.parse(data);
    },

    async revoke(id: string): Promise<void> {
        await apiClient.delete(`/api-tokens/${id}`);
    },
};

export const API_TOKENS_QUERY_KEY = ['api-tokens'] as const;

export function useApiTokens() {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: API_TOKENS_QUERY_KEY,
        queryFn: () => apiTokensApi.list(),
        enabled: isAuthenticated,
    });
}

export function useCreateApiToken() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (name: string) => apiTokensApi.create(name),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to create token')),
        onSettled: () => queryClient.invalidateQueries({ queryKey: API_TOKENS_QUERY_KEY }),
    });
}

export function useRevokeApiToken() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => apiTokensApi.revoke(id),
        onSuccess: () => toast.success('Token revoked'),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to revoke token')),
        onSettled: () => queryClient.invalidateQueries({ queryKey: API_TOKENS_QUERY_KEY }),
    });
}

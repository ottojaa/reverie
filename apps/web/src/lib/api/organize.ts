import { OrganizeExecuteResponseSchema, type OrganizeExecuteRequest, type OrganizeExecuteResponse, type OrganizeOperation } from '@reverie/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

// ── useExecuteOrganize mutation ───────────────────────────────────────────────

export const organizeApi = {
    async execute(operations: OrganizeOperation[]): Promise<OrganizeExecuteResponse> {
        const body: OrganizeExecuteRequest = { operations };
        const { data } = await apiClient.post('/organize/execute', body);

        return OrganizeExecuteResponseSchema.parse(data);
    },
};

export function useExecuteOrganize() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (operations: OrganizeOperation[]) => organizeApi.execute(operations),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
    });
}

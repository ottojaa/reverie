import { VaultStatusSchema, type VaultSecretRequest, type VaultStatus } from '@reverie/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export const vaultApi = {
    async status(): Promise<VaultStatus> {
        const { data } = await apiClient.get('/vault/status');

        return VaultStatusSchema.parse(data);
    },

    /** Opens the lock of one private folder for this session. `typed` is whatever the status' `ask` names. */
    async unlock(typed: string, folderId: string): Promise<VaultStatus> {
        const { data } = await apiClient.post('/vault/unlock', { password: typed, folder_id: folderId });

        return VaultStatusSchema.parse(data);
    },

    /** Sets, changes or removes the PIN or lock password, proven with the account password. */
    async saveSecret(request: VaultSecretRequest): Promise<VaultStatus> {
        const { data } = await apiClient.put('/vault/secret', request);

        return VaultStatusSchema.parse(data);
    },
};

export const vaultStatusQuery = queryOptions({
    queryKey: ['vault', 'status'],
    queryFn: () => vaultApi.status(),
    staleTime: 30 * 1000,
});

/** Queries whose results depend on which locks are open (folder tree, listings, detail views, trash). */
const LOCK_DEPENDENT_QUERY_KEYS = [['vault'], ['sections'], ['documents'], ['document'], ['search'], ['trash']] as const;

export function invalidateLockDependentQueries(queryClient: QueryClient): void {
    for (const queryKey of LOCK_DEPENDENT_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
    }
}

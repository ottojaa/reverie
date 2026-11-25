import { VaultStatusSchema, type VaultStatus } from '@reverie/shared';
import { apiClient } from './client';

export const vaultApi = {
    async status(): Promise<VaultStatus> {
        const { data } = await apiClient.get('/vault/status');

        return VaultStatusSchema.parse(data);
    },

    /** Opens the lock of one private folder for this session (checks the account password). */
    async unlock(password: string, folderId: string): Promise<VaultStatus> {
        const { data } = await apiClient.post('/vault/unlock', { password, folder_id: folderId });

        return VaultStatusSchema.parse(data);
    },
};

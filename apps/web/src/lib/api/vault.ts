import { VaultStatusSchema, type VaultStatus } from '@reverie/shared';
import { apiClient } from './client';

export const vaultApi = {
    async status(): Promise<VaultStatus> {
        const { data } = await apiClient.get('/vault/status');

        return VaultStatusSchema.parse(data);
    },

    async unlock(password: string): Promise<VaultStatus> {
        const { data } = await apiClient.post('/vault/unlock', { password });

        return VaultStatusSchema.parse(data);
    },

    async lock(): Promise<VaultStatus> {
        const { data } = await apiClient.post('/vault/lock');

        return VaultStatusSchema.parse(data);
    },

    async setHidePrivate(hide_private: boolean): Promise<VaultStatus> {
        const { data } = await apiClient.patch('/vault/settings', { hide_private });

        return VaultStatusSchema.parse(data);
    },
};

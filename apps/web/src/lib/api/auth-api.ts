import { apiClient } from './client';

export const authApi = {
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        await apiClient.post('/auth/change-password', {
            current_password: currentPassword,
            new_password: newPassword,
        });
    },
};

import { OidcProvidersResponseSchema, type OidcProvider } from '@reverie/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export const authApi = {
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        await apiClient.post('/auth/change-password', {
            current_password: currentPassword,
            new_password: newPassword,
        });
    },

    /** The external sign-in providers this server offers (public: the login page asks before anyone is signed in). */
    async listSignInProviders(): Promise<OidcProvider[]> {
        const { data } = await apiClient.get('/auth/oidc/providers');

        return OidcProvidersResponseSchema.parse(data).providers;
    },
};

export function useSignInProviders() {
    return useQuery({
        queryKey: ['sign-in-providers'],
        queryFn: () => authApi.listSignInProviders(),
        staleTime: 5 * 60 * 1000,
    });
}

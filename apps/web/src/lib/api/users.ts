import type { User } from '@reverie/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';
import { useAuth } from '../auth';

export const usersApi = {
    async getCurrent(): Promise<User> {
        const { data } = await apiClient.get<{ user: User }>('/auth/me');

        return data.user;
    },
};

export function useUser() {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['user'],
        queryFn: () => usersApi.getCurrent(),
        enabled: isAuthenticated,
    });
}

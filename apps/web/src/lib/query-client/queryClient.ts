import { QueryClient } from '@tanstack/react-query';
import { isFolderLockedError } from '../api/folder-locked';

const MAX_QUERY_RETRIES = 1;

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            // A closed folder lock stays closed until the user unlocks it; retrying only repeats the 403.
            retry: (failureCount, error) => !isFolderLockedError(error) && failureCount < MAX_QUERY_RETRIES,
        },
    },
});

export const getQueryClient = () => {
    return queryClient;
};

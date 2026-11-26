import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { foldersApi } from '../api/folders';
import { useSections } from '../sections';
import { findFolder } from './tree.js';

/** True when the folder no longer exists. One behind a closed lock still does: the server refuses it instead. */
export function fetchIsFolderGone(folderId: string): Promise<boolean> {
    return foldersApi.get(folderId).then(
        () => false,
        (error: unknown) => isAxiosError(error) && error.response?.status === 404,
    );
}

/** Whether a folder the loaded tree leaves out is gone, rather than hidden under a closed lock. */
export function useIsFolderGone(folderId: string | null | undefined): boolean {
    const { data: tree } = useSections();
    const isUnlisted = !!folderId && !!tree && !findFolder(tree, folderId);
    const { data } = useQuery({
        queryKey: ['folder-gone', folderId],
        queryFn: () => fetchIsFolderGone(folderId!),
        enabled: isUnlisted,
        staleTime: 0,
    });

    return isUnlisted && data === true;
}

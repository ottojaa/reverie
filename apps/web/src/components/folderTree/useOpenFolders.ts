import { findFolderChain } from '@/lib/folders/tree.js';
import type { FolderWithChildren } from '@reverie/shared';
import { useCallback, useEffect, useState } from 'react';

function toPathKey(tree: FolderWithChildren[], currentId: string | undefined): string {
    if (!currentId) return '';

    return findFolderChain(tree, currentId)
        .slice(0, -1)
        .map((folder) => folder.id)
        .join(',');
}

/** Which folders show their subfolders. All start closed, and the way to the current folder is opened. */
export function useOpenFolders(tree: FolderWithChildren[], currentId: string | undefined) {
    const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
    // A string, so the effect runs when the way to the current folder changes, not on every refetch of the tree.
    const pathKey = toPathKey(tree, currentId);

    const open = useCallback((folderIds: string[]) => setOpenIds((ids) => new Set([...ids, ...folderIds])), []);

    useEffect(() => {
        if (pathKey) open(pathKey.split(','));
    }, [pathKey, open]);

    function toggle(folderId: string) {
        setOpenIds((ids) => {
            const next = new Set(ids);

            if (!next.delete(folderId)) next.add(folderId);

            return next;
        });
    }

    return { openIds, open, toggle };
}

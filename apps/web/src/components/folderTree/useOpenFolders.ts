import { findFolderChain } from '@/lib/folders/tree.js';
import type { FolderWithChildren } from '@reverie/shared';
import { useCallback, useEffect, useState } from 'react';

type OpenFolder = Pick<FolderWithChildren, 'id' | 'parent_id'>;

function toPathKey(tree: FolderWithChildren[], currentId: string | undefined): string {
    if (!currentId) return '';

    return findFolderChain(tree, currentId)
        .slice(0, -1)
        .map((folder) => folder.id)
        .join(',');
}

function isOpenAmong(changes: ReadonlyMap<string, boolean>, folder: OpenFolder): boolean {
    return changes.get(folder.id) ?? folder.parent_id === null;
}

/** Which folders show their subfolders. Top-level ones start open and deeper ones closed, and the way to the current folder is opened. */
export function useOpenFolders(tree: FolderWithChildren[], currentId: string | undefined) {
    // Only the folders opened or closed since: the rest go by their level.
    const [changes, setChanges] = useState<ReadonlyMap<string, boolean>>(new Map());
    // A string, so the effect runs when the way to the current folder changes, not on every refetch of the tree.
    const pathKey = toPathKey(tree, currentId);

    const open = useCallback((folderIds: string[]) => setChanges((previous) => new Map([...previous, ...folderIds.map((id) => [id, true] as const)])), []);

    useEffect(() => {
        if (pathKey) open(pathKey.split(','));
    }, [pathKey, open]);

    function toggle(folder: OpenFolder) {
        setChanges((previous) => new Map(previous).set(folder.id, !isOpenAmong(previous, folder)));
    }

    return { isOpen: (folder: OpenFolder) => isOpenAmong(changes, folder), open, toggle };
}

import type { FolderWithChildren } from '@reverie/shared';
import { flattenTree } from './tree.js';

/** Which padlock a folder row shows: closed, open, or none for a public one. */
export type FolderLockState = 'locked' | 'unlocked' | 'none';

export function toFolderLockState(node: Pick<FolderWithChildren, 'is_private' | 'locked'>): FolderLockState {
    if (node.locked) return 'locked';

    return node.is_private ? 'unlocked' : 'none';
}

/** True when a private folder above keeps this one private, whether or not it is also marked private itself. */
export function isInheritedPrivate(folder: Pick<FolderWithChildren, 'id' | 'lock_id'>): boolean {
    // `lock_id` names the outermost private folder on the way down, so only that one's own flag decides.
    return folder.lock_id !== null && folder.lock_id !== folder.id;
}

/** The tree without private folders, which also leaves out everything inside them. */
export function toPublicTree(tree: FolderWithChildren[]): FolderWithChildren[] {
    return tree.filter((folder) => folder.lock_id === null).map((folder) => ({ ...folder, children: toPublicTree(folder.children) }));
}

/** True when some folder beneath this one sits behind a different lock, so this folder's counts leave it out. */
export function hasOtherLockBelow(folder: FolderWithChildren): boolean {
    return flattenTree(folder.children).some((row) => row.folder.lock_id !== folder.lock_id);
}

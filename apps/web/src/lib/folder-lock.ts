import type { FolderWithChildren } from '@reverie/shared';

/** Which padlock a folder or collection row shows: closed, open, or none for a public one. */
export type FolderLockState = 'locked' | 'unlocked' | 'none';

export function toFolderLockState(node: Pick<FolderWithChildren, 'is_private' | 'locked'>): FolderLockState {
    if (node.locked) return 'locked';

    return node.is_private ? 'unlocked' : 'none';
}

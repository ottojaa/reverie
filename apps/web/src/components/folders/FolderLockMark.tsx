import { toFolderLockState } from '@/lib/folder-lock';
import type { FolderWithChildren } from '@reverie/shared';
import { Lock, LockOpen } from 'lucide-react';

/** A padlock beside a private folder's name, closed or open. Public folders show nothing. */
export function FolderLockMark({ folder }: { folder: FolderWithChildren }) {
    const state = toFolderLockState(folder);

    if (state === 'locked') return <Lock className="size-3.5 shrink-0 text-accent" aria-label="Locked" />;

    if (state === 'unlocked') return <LockOpen className="size-3.5 shrink-0 text-accent" aria-label="Private (unlocked)" />;

    return null;
}

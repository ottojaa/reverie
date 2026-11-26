import { Button } from '@/components/ui/button';
import { toFolderLockState } from '@/lib/folders/privacy.js';
import type { FolderWithChildren } from '@reverie/shared';
import { Lock, LockOpen } from 'lucide-react';

interface FolderPadlockProps {
    folder: Pick<FolderWithChildren, 'is_private' | 'locked'>;
    /** Makes a closed padlock a button that opens the lock. Leave out inside another button or link. */
    onUnlock?: () => void;
}

/** The padlock beside a private folder's name, closed or open. Public folders show nothing. */
export function FolderPadlock({ folder, onUnlock }: FolderPadlockProps) {
    const state = toFolderLockState(folder);

    if (state === 'none') return null;

    if (state === 'unlocked') return <LockOpen className="size-3.5 shrink-0 text-accent" aria-label="Private (unlocked)" />;

    if (!onUnlock) return <Lock className="size-3.5 shrink-0 text-accent" aria-label="Locked" />;

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-auto shrink-0 rounded p-0 text-accent transition-transform hover:scale-110 hover:bg-transparent hover:text-accent dark:hover:bg-transparent"
            aria-label="Locked, click to unlock"
            title="Locked, click to unlock"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onUnlock();
            }}
        >
            <Lock className="size-3.5" />
        </Button>
    );
}

import { Button } from '@/components/ui/button';
import type { FolderLockState } from '@/lib/folder-lock';
import { Lock, LockOpen } from 'lucide-react';

/**
 * Padlock on a private folder's row: a closed one is a button that asks for the password, an open one only
 * marks the folder as private. Public folders, and folders private through a parent, show nothing.
 */
export function FolderLockBadge({ state, onUnlock }: { state: FolderLockState; onUnlock: () => void }) {
    if (state === 'none') return null;

    if (state === 'unlocked') return <LockOpen className="size-3.5 shrink-0 text-accent" aria-label="Private (unlocked)" />;

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

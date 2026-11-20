import type { FolderLockState } from '@/lib/folder-lock';
import { Lock, LockOpen } from 'lucide-react';

/**
 * Padlock on a private folder or collection row: a closed one is a button that asks for the
 * password, an open one only marks the folder as private. Public folders show nothing.
 */
export function FolderLockBadge({ state, onUnlock }: { state: FolderLockState; onUnlock: () => void }) {
    if (state === 'none') return null;

    if (state === 'unlocked') return <LockOpen className="size-3 shrink-0 text-accent" aria-label="Private (unlocked)" />;

    return (
        <button
            type="button"
            className="shrink-0 text-accent transition-transform hover:scale-110"
            aria-label="Locked, click to unlock"
            title="Locked, click to unlock"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onUnlock();
            }}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <Lock className="size-3" />
        </button>
    );
}

import { useConfirm } from '@/lib/confirm';
import { useVault } from '@/lib/vault';
import { cn } from '@/lib/utils';
import { Lock } from 'lucide-react';

/**
 * Sidebar footer control for the private-items vault. Shows a "Lock private items" button
 * only while the vault is unlocked; when locked, the per-resource lock icons are the unlock
 * entry points (there is no app-wide reveal). Locking asks for confirmation first.
 */
export function VaultSidebarControl() {
    const { unlocked, lockNow, isLocking } = useVault();
    const confirm = useConfirm();

    if (!unlocked) return null;

    const handleLock = async () => {
        const ok = await confirm({
            title: 'Lock private items?',
            description: "Private folders and files will be hidden again — you'll need your account password to open them for the rest of this session.",
            confirmText: 'Lock',
            cancelText: 'Cancel',
        });

        if (ok) lockNow();
    };

    return (
        <button
            type="button"
            onClick={handleLock}
            disabled={isLocking}
            className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'text-accent hover:bg-accent/10 disabled:opacity-50',
            )}
        >
            <Lock className="size-4" />
            <span className="flex-1 text-left">Lock private items</span>
        </button>
    );
}

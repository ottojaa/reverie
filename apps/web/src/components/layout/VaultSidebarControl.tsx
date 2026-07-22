import { useVault } from '@/lib/vault';
import { cn } from '@/lib/utils';
import { Lock } from 'lucide-react';

/**
 * Sidebar footer control for the private-items vault. Shows a "Lock private items" button
 * only while the vault is unlocked; when locked, the per-resource lock icons are the unlock
 * entry points (there is no app-wide reveal).
 */
export function VaultSidebarControl() {
    const { unlocked, lockNow, isLocking } = useVault();

    if (!unlocked) return null;

    return (
        <button
            type="button"
            onClick={lockNow}
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

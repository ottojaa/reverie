import { useVault } from '@/lib/vault';
import { cn } from '@/lib/utils';
import { Lock, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Live mm:ss remaining until the vault auto-locks. */
function useCountdown(expiresAt: string | null): string | null {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!expiresAt) return;

        const t = setInterval(() => setNow(Date.now()), 1000);

        return () => clearInterval(t);
    }, [expiresAt]);

    if (!expiresAt) return null;

    const ms = new Date(expiresAt).getTime() - now;

    if (ms <= 0) return '0:00';

    const total = Math.floor(ms / 1000);

    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Sidebar footer control for the private-items vault. Only rendered when the user has
 * enabled hiding: shows "Reveal private" (opens the passcode modal) while locked, and
 * "Lock now" + a countdown while unlocked.
 */
export function VaultSidebarControl() {
    const { hideEnabled, unlocked, expiresAt, openReveal, lockNow, isLocking } = useVault();
    const remaining = useCountdown(unlocked ? expiresAt : null);

    if (!hideEnabled) return null;

    if (!unlocked) {
        return (
            <button
                type="button"
                onClick={openReveal}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
            >
                <LockKeyhole className="size-4" />
                Reveal private
            </button>
        );
    }

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
            <span className="flex-1 text-left">Lock now</span>
            {remaining && <span className="tabular-nums text-xs text-muted-foreground">{remaining}</span>}
        </button>
    );
}

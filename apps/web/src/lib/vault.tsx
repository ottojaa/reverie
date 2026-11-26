import { UnlockDialog, type UnlockPrompt } from '@/components/vault/UnlockDialog';
import type { LockAsk } from '@reverie/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { vaultStatusQuery } from './api/vault';
import { useAuth } from './auth';

interface VaultContextValue {
    /** Whether the account has a password, without which nothing locks; null until the status has loaded. */
    hasPassword: boolean | null;
    /** What opens a private folder now; null until the status has loaded, and when nothing locks. */
    ask: LockAsk | null;
    /**
     * Ask for what opens one private folder. Resolves true once that lock is open and the
     * dependent queries are refetching, false if the user cancels. Opening one lock never opens another.
     */
    requestUnlock: (folderId: string) => Promise<boolean>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

interface VaultProviderProps {
    /** Takes the user to where the lock secret is set, changed and removed. */
    onOpenLockSettings: () => void;
    children?: ReactNode;
}

export function VaultProvider({ onOpenLockSettings, children }: VaultProviderProps) {
    const { isAuthenticated } = useAuth();
    const [prompt, setPrompt] = useState<UnlockPrompt | null>(null);
    // Resolves the promise handed out by the open request; null while no prompt is showing.
    const resolverRef = useRef<((unlocked: boolean) => void) | null>(null);
    const { data: status } = useQuery({ ...vaultStatusQuery, enabled: isAuthenticated });

    const requestUnlock = useCallback((folderId: string) => {
        // A newer request replaces an unanswered one; the replaced caller sees a cancel.
        resolverRef.current?.(false);

        return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            setPrompt((last) => ({ folderId, isOpen: true, attempt: (last?.attempt ?? 0) + 1 }));
        });
    }, []);

    const settle = useCallback((unlocked: boolean) => {
        resolverRef.current?.(unlocked);
        resolverRef.current = null;
        setPrompt((last) => last && { ...last, isOpen: false });
    }, []);

    const handleForgot = () => {
        settle(false);
        onOpenLockSettings();
    };

    const value: VaultContextValue = { hasPassword: status?.has_password ?? null, ask: status?.ask ?? null, requestUnlock };

    return (
        <VaultContext.Provider value={value}>
            {children}
            <UnlockDialog prompt={prompt} onSettled={settle} onForgot={handleForgot} />
        </VaultContext.Provider>
    );
}

export function useVault(): VaultContextValue {
    const ctx = useContext(VaultContext);

    if (!ctx) throw new Error('useVault must be used within VaultProvider');

    return ctx;
}

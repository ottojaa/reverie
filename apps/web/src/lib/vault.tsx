import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { motion, useAnimationControls } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { toUnlockErrorMessage } from './api/folder-locked';
import { vaultApi } from './api/vault';
import { useAuth } from './auth';

interface VaultContextValue {
    /** Whether the account has a password to lock folders with; null until the status has loaded. */
    hasPassword: boolean | null;
    /**
     * Ask for the account password to open one private folder. Resolves true once
     * that lock is open and the dependent queries are refetching, false if the user cancels.
     * Opening one lock never opens another.
     */
    requestUnlock: (folderId: string) => Promise<boolean>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

/** Queries whose results depend on which locks are open (folder tree, listings, detail views, trash). */
const LOCK_DEPENDENT_QUERY_KEYS = [['vault'], ['sections'], ['documents'], ['document'], ['search'], ['trash']] as const;

export function VaultProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [folderId, setFolderId] = useState<string | null>(null);
    // Resolves the promise handed out by the open request; null while no prompt is showing.
    const resolverRef = useRef<((unlocked: boolean) => void) | null>(null);

    const { data: status } = useQuery({
        queryKey: ['vault', 'status'],
        queryFn: () => vaultApi.status(),
        enabled: isAuthenticated,
        staleTime: 30 * 1000,
    });

    const requestUnlock = useCallback((id: string) => {
        // A newer request replaces an unanswered one; the replaced caller sees a cancel.
        resolverRef.current?.(false);

        return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            setFolderId(id);
        });
    }, []);

    const settle = useCallback(
        (unlocked: boolean) => {
            resolverRef.current?.(unlocked);
            resolverRef.current = null;
            setFolderId(null);

            if (!unlocked) return;

            for (const queryKey of LOCK_DEPENDENT_QUERY_KEYS) {
                void queryClient.invalidateQueries({ queryKey });
            }
        },
        [queryClient],
    );

    const value: VaultContextValue = { hasPassword: status?.has_password ?? null, requestUnlock };

    return (
        <VaultContext.Provider value={value}>
            {children}
            <UnlockDialog folderId={folderId} hasPassword={status?.has_password ?? null} onSettled={settle} />
        </VaultContext.Provider>
    );
}

export function useVault(): VaultContextValue {
    const ctx = useContext(VaultContext);

    if (!ctx) throw new Error('useVault must be used within VaultProvider');

    return ctx;
}

/** Password prompt for one folder lock. It reuses the account login password. */
function UnlockDialog({ folderId, hasPassword, onSettled }: { folderId: string | null; hasPassword: boolean | null; onSettled: (unlocked: boolean) => void }) {
    const open = folderId !== null;
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const shake = useAnimationControls();

    const unlockMutation = useMutation({
        mutationFn: ({ pw, id }: { pw: string; id: string }) => vaultApi.unlock(pw, id),
    });

    useEffect(() => {
        if (!open) return;

        setPassword('');
        setError(null);
        // Focus after the dialog mount/animation.
        const t = setTimeout(() => inputRef.current?.focus(), 50);

        return () => clearTimeout(t);
    }, [open, folderId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!password || !folderId) return;

        try {
            await unlockMutation.mutateAsync({ pw: password, id: folderId });
            onSettled(true);
        } catch (err) {
            setError(toUnlockErrorMessage(err));
            setPassword('');
            void shake.start({ x: [0, -8, 8, -6, 6, -3, 3, 0], transition: { duration: 0.4 } });
            inputRef.current?.focus();
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onSettled(false)}>
            <DialogContent showCloseButton className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <span className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-accent">
                            <LockKeyhole className="size-4" />
                        </span>
                        <DialogTitle>Unlock private folder</DialogTitle>
                    </div>
                    <DialogDescription>
                        {hasPassword === false
                            ? 'Your account has no password, so nothing is locked yet.'
                            : 'Enter your account password to open this folder. It stays open until you sign out or quit, and other private folders stay locked.'}
                    </DialogDescription>
                </DialogHeader>

                {hasPassword === false && (
                    <p className="text-sm text-muted-foreground">Set a password under Settings, Change Password, to lock private folders.</p>
                )}

                {hasPassword !== false && (
                    <motion.form animate={shake} onSubmit={handleSubmit} className="flex flex-col gap-3">
                        <Input
                            ref={inputRef}
                            type="password"
                            autoComplete="current-password"
                            placeholder="Account password"
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setError(null);
                            }}
                            aria-invalid={!!error}
                        />
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" onClick={() => onSettled(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={!password || unlockMutation.isPending}>
                                {unlockMutation.isPending ? 'Unlocking…' : 'Unlock'}
                            </Button>
                        </div>
                    </motion.form>
                )}
            </DialogContent>
        </Dialog>
    );
}

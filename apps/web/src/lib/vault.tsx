import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { VaultStatus } from '@reverie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { motion, useAnimationControls } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { vaultApi } from './api/vault';
import { useAuth } from './auth';

interface VaultContextValue {
    unlocked: boolean;
    hasPassword: boolean;
    isLoading: boolean;
    /**
     * Open the passcode modal to unlock private items. The optional callback runs once
     * after a successful unlock — pass a navigate-by-id closure to retry opening the item
     * the user just clicked (content is refetched unlocked by then).
     */
    requestUnlock: (onUnlocked?: () => void) => void;
    /** Re-lock private items immediately. */
    lockNow: () => void;
    isLocking: boolean;
}

const VaultContext = createContext<VaultContextValue | null>(null);

const LOCKED_DEFAULT: VaultStatus = { unlocked: false, has_password: false };

export function VaultProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [revealOpen, setRevealOpen] = useState(false);
    // Action to run after the next successful unlock (e.g. open the clicked item).
    const pendingActionRef = useRef<(() => void) | null>(null);

    const { data: status = LOCKED_DEFAULT, isLoading } = useQuery({
        queryKey: ['vault', 'status'],
        queryFn: () => vaultApi.status(),
        enabled: isAuthenticated,
        staleTime: 30 * 1000,
    });

    // Refetch private-bearing views so redacted↔full content swaps in after a lock/unlock.
    // Covers the folder tree (['sections']/['folders']), document lists (['documents']) and
    // per-document detail (['document', id]) used by the viewer.
    const refetchPrivate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['vault', 'status'] });
        queryClient.invalidateQueries({ queryKey: ['sections'] });
        queryClient.invalidateQueries({ queryKey: ['documents'] });
        queryClient.invalidateQueries({ queryKey: ['document'] });
        queryClient.invalidateQueries({ queryKey: ['folders'] });
    }, [queryClient]);

    const lockMutation = useMutation({
        mutationFn: () => vaultApi.lock(),
        onSuccess: (next) => {
            queryClient.setQueryData(['vault', 'status'], next);
            refetchPrivate();
        },
    });

    const requestUnlock = useCallback((onUnlocked?: () => void) => {
        pendingActionRef.current = onUnlocked ?? null;
        setRevealOpen(true);
    }, []);

    const handleUnlocked = useCallback(() => {
        refetchPrivate();
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        action?.();
    }, [refetchPrivate]);

    const value: VaultContextValue = {
        unlocked: status.unlocked,
        hasPassword: status.has_password,
        isLoading,
        requestUnlock,
        lockNow: () => lockMutation.mutate(),
        isLocking: lockMutation.isPending,
    };

    return (
        <VaultContext.Provider value={value}>
            {children}
            <RevealDialog
                open={revealOpen}
                onOpenChange={(open) => {
                    if (!open) pendingActionRef.current = null;
                    setRevealOpen(open);
                }}
                hasPassword={status.has_password}
                onUnlocked={handleUnlocked}
            />
        </VaultContext.Provider>
    );
}

export function useVault(): VaultContextValue {
    const ctx = useContext(VaultContext);

    if (!ctx) throw new Error('useVault must be used within VaultProvider');

    return ctx;
}

/** Passcode modal — reuses the account login password to unlock private items for the session. */
function RevealDialog({
    open,
    onOpenChange,
    hasPassword,
    onUnlocked,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    hasPassword: boolean;
    onUnlocked: () => void;
}) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const shake = useAnimationControls();

    const unlockMutation = useMutation({
        mutationFn: (pw: string) => vaultApi.unlock(pw),
    });

    useEffect(() => {
        if (!open) return;

        setPassword('');
        setError(null);
        // Focus after the dialog mount/animation.
        const t = setTimeout(() => inputRef.current?.focus(), 50);

        return () => clearTimeout(t);
    }, [open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!password) return;

        try {
            await unlockMutation.mutateAsync(password);
            onUnlocked();
            onOpenChange(false);
        } catch {
            setError('Incorrect password. Try again.');
            setPassword('');
            void shake.start({ x: [0, -8, 8, -6, 6, -3, 3, 0], transition: { duration: 0.4 } });
            inputRef.current?.focus();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <span className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-accent">
                            <LockKeyhole className="size-4" />
                        </span>
                        <DialogTitle>Unlock private items</DialogTitle>
                    </div>
                    <DialogDescription>
                        {hasPassword
                            ? 'Enter your account password to open private folders and files. They stay unlocked until you lock them or quit, and stay out of search either way.'
                            : 'Set an account password in Settings first — locking private items needs a password to unlock with.'}
                    </DialogDescription>
                </DialogHeader>

                {hasPassword && (
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
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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

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
    hideEnabled: boolean;
    unlocked: boolean;
    hasPassword: boolean;
    expiresAt: string | null;
    isLoading: boolean;
    /** Open the passcode modal to reveal hidden private items. */
    openReveal: () => void;
    /** Re-hide private items immediately. */
    lockNow: () => void;
    isLocking: boolean;
    /** Enable/disable hiding private items from the sidebar. */
    setHideEnabled: (value: boolean) => Promise<VaultStatus>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

const LOCKED_DEFAULT: VaultStatus = { hide_enabled: false, unlocked: false, expires_at: null, has_password: false };

export function VaultProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [revealOpen, setRevealOpen] = useState(false);

    const { data: status = LOCKED_DEFAULT, isLoading } = useQuery({
        queryKey: ['vault', 'status'],
        queryFn: () => vaultApi.status(),
        enabled: isAuthenticated,
        staleTime: 30 * 1000,
    });

    // Refetch private-bearing views + the vault state itself.
    const refetchPrivate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['vault', 'status'] });
        queryClient.invalidateQueries({ queryKey: ['sections'] });
        queryClient.invalidateQueries({ queryKey: ['documents'] });
    }, [queryClient]);

    const lockMutation = useMutation({
        mutationFn: () => vaultApi.lock(),
        onSuccess: (next) => {
            queryClient.setQueryData(['vault', 'status'], next);
            queryClient.invalidateQueries({ queryKey: ['sections'] });
            queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
    });

    const setHideMutation = useMutation({
        mutationFn: (value: boolean) => vaultApi.setHidePrivate(value),
        onSuccess: (next) => {
            queryClient.setQueryData(['vault', 'status'], next);
            queryClient.invalidateQueries({ queryKey: ['sections'] });
            queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
    });

    // Auto-lock: when the vault session expires, flip the UI back to locked and drop
    // private items from the views. The server cookie has already expired by then.
    useEffect(() => {
        if (!status.unlocked || !status.expires_at) return;

        const ms = new Date(status.expires_at).getTime() - Date.now();

        if (ms <= 0) {
            refetchPrivate();

            return;
        }

        const timer = setTimeout(refetchPrivate, ms);

        return () => clearTimeout(timer);
    }, [status.unlocked, status.expires_at, refetchPrivate]);

    const setHideEnabled = useCallback((value: boolean) => setHideMutation.mutateAsync(value), [setHideMutation]);

    const value: VaultContextValue = {
        hideEnabled: status.hide_enabled,
        unlocked: status.unlocked,
        hasPassword: status.has_password,
        expiresAt: status.expires_at,
        isLoading,
        openReveal: () => setRevealOpen(true),
        lockNow: () => lockMutation.mutate(),
        isLocking: lockMutation.isPending,
        setHideEnabled,
    };

    return (
        <VaultContext.Provider value={value}>
            {children}
            <RevealDialog open={revealOpen} onOpenChange={setRevealOpen} hasPassword={status.has_password} onUnlocked={refetchPrivate} />
        </VaultContext.Provider>
    );
}

export function useVault(): VaultContextValue {
    const ctx = useContext(VaultContext);

    if (!ctx) throw new Error('useVault must be used within VaultProvider');

    return ctx;
}

/** Passcode modal — reuses the account login password to reveal hidden private items. */
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
                        <DialogTitle>Reveal private items</DialogTitle>
                    </div>
                    <DialogDescription>
                        {hasPassword
                            ? 'Enter your account password to reveal private folders and files. They stay out of search either way.'
                            : 'Set an account password in Settings first — private hiding needs a password to unlock with.'}
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

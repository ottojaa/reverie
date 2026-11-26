import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toUnlockFailure } from '@/lib/api/folder-locked';
import { invalidateLockDependentQueries, vaultApi, vaultStatusQuery } from '@/lib/api/vault';
import { findFolder } from '@/lib/folders/tree';
import type { FolderWithChildren, LockAsk, VaultStatus } from '@reverie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { UnlockForm } from './UnlockForm';

export interface UnlockPrompt {
    folderId: string;
    isOpen: boolean;
    /** Goes up with each request, so that every prompt starts afresh. */
    attempt: number;
}

interface UnlockDialogProps {
    /** The latest request, kept once answered so that the closing dialog does not change; null before the first. */
    prompt: UnlockPrompt | null;
    onSettled: (unlocked: boolean) => void;
    onForgot: () => void;
}

/** The prompt for one folder lock. It asks for the PIN, the lock password or the account password, as the server says. */
export function UnlockDialog({ prompt, onSettled, onForgot }: UnlockDialogProps) {
    return (
        <Dialog open={!!prompt?.isOpen} onOpenChange={(next) => !next && onSettled(false)}>
            <DialogContent showCloseButton className="sm:max-w-md">
                {prompt && <PromptBody key={prompt.attempt} prompt={prompt} onSettled={onSettled} onForgot={onForgot} />}
            </DialogContent>
        </Dialog>
    );
}

function toDescription(status: VaultStatus | undefined): string {
    if (!status) return 'Checking how this folder opens.';

    if (!status.has_password) return 'Your account has no password, so nothing is locked yet.';

    if (status.ask === 'pin') return 'Enter your PIN.';

    if (status.ask === 'password') return 'Enter your lock password.';

    // A secret is set and the account password is asked for: the tries ran out.
    if (status.secret_kind) return 'Too many wrong tries. Enter your account password.';

    return 'Enter your account password to open this folder. It stays open until you sign out or quit, and other private folders stay locked.';
}

/** The value as it was while open: a closing dialog goes on showing what it showed. */
function useWhileOpen<T>(value: T, isOpen: boolean): T {
    const [kept, setKept] = useState(value);

    if (isOpen && kept !== value) setKept(value);

    return isOpen ? value : kept;
}

/**
 * The vault status as fetched since the prompt opened. A cached one may name a secret that has since been changed or
 * stopped, and a try typed for it would be counted.
 */
function useFreshVaultStatus() {
    const [openedAt] = useState(() => Date.now());
    const query = useQuery({ ...vaultStatusQuery, refetchOnMount: 'always' });
    const status = query.dataUpdatedAt >= openedAt ? query.data : undefined;

    return { status, isFailed: !status && query.isError && !query.isFetching, retry: () => void query.refetch() };
}

/** Sends tries at one folder's lock, and keeps the line about the last refused one. */
function useUnlockTries(folderId: string, onUnlocked: () => void) {
    const queryClient = useQueryClient();
    const [failure, setFailure] = useState<{ count: number; message: string | null }>({ count: 0, message: null });
    const unlock = useMutation({
        mutationFn: (typed: string) => vaultApi.unlock(typed, folderId),
        // Here and not in the call below, so that a lock opened after the prompt was cancelled still shows.
        onSuccess: () => invalidateLockDependentQueries(queryClient),
    });

    const submit = (typed: string, askedFor: LockAsk) => {
        if (unlock.isPending) return;

        unlock.mutate(typed, {
            onSuccess: onUnlocked,
            onError: (error) => {
                const { status, message } = toUnlockFailure(error, askedFor);

                queryClient.setQueryData(vaultStatusQuery.queryKey, (cached) => cached && { ...cached, ...status });
                setFailure(({ count }) => ({ count: count + 1, message }));
            },
        });
    };

    const clearError = () => setFailure((last) => (last.message ? { ...last, message: null } : last));

    return { failure, isPending: unlock.isPending, submit, clearError };
}

/** The buttons while there is nothing to type: the status is on its way, did not come, or says nothing locks. */
function WaitingFooter({ isChecking, onRetry, onCancel }: { isChecking: boolean; onRetry: (() => void) | null; onCancel: () => void }) {
    return (
        <div className="flex items-center justify-end gap-2">
            {isChecking && <Loader2 className="mr-auto size-4 animate-spin text-muted-foreground" />}
            <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
            </Button>
            {onRetry && (
                <Button type="button" onClick={onRetry}>
                    Try again
                </Button>
            )}
        </div>
    );
}

function PromptBody({ prompt, onSettled, onForgot }: { prompt: UnlockPrompt } & Omit<UnlockDialogProps, 'prompt'>) {
    const queryClient = useQueryClient();
    const tree = queryClient.getQueryData<FolderWithChildren[]>(['sections', 'tree']);
    const folderName = findFolder(tree ?? [], prompt.folderId)?.name;
    const fresh = useFreshVaultStatus();
    const status = useWhileOpen(fresh.status, prompt.isOpen);
    const { failure, isPending, submit, clearError } = useUnlockTries(prompt.folderId, () => onSettled(true));
    const ask = status?.ask;

    return (
        <>
            <DialogHeader>
                <div className="flex min-w-0 items-center gap-2 pr-6">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                        <LockKeyhole className="size-4" />
                    </span>
                    <DialogTitle className="min-w-0 leading-snug wrap-anywhere">{folderName ? `Unlock "${folderName}"` : 'Unlock private folder'}</DialogTitle>
                </div>
                <DialogDescription>{fresh.isFailed ? 'Could not check how this folder opens.' : toDescription(status)}</DialogDescription>
            </DialogHeader>

            {status && !status.has_password && (
                <p className="text-sm text-muted-foreground">Set a password under Settings, Change Password, to lock private folders.</p>
            )}

            {!ask && <WaitingFooter isChecking={!status && !fresh.isFailed} onRetry={fresh.isFailed ? fresh.retry : null} onCancel={() => onSettled(false)} />}

            {ask && (
                <UnlockForm
                    // A new form after each refused try and each change of what is asked: empty and focused.
                    key={`${ask}:${failure.count}`}
                    ask={ask}
                    error={failure.message}
                    isRetry={failure.count > 0}
                    isPending={isPending}
                    onEdit={clearError}
                    onSubmit={(typed) => submit(typed, ask)}
                    onCancel={() => onSettled(false)}
                    onForgot={onForgot}
                />
            )}
        </>
    );
}

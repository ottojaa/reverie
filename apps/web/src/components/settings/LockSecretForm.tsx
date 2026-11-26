import type { LockAsk, LockSecretKind } from '@reverie/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../lib/api/client';
import { invalidateLockDependentQueries, vaultApi, vaultStatusQuery } from '../../lib/api/vault';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { toDraft, toDraftProblem, toSecretRequest, type LockSecretDraft } from './lock-secret-draft';
import { LockField, LockSecretFields } from './LockSecretFields';

const CHOICES: { value: LockAsk; label: string }[] = [
    { value: 'pin', label: 'PIN' },
    { value: 'password', label: 'Password' },
    { value: 'account_password', label: 'Account password' },
];

const SAVED_MESSAGES: Record<LockAsk, string> = {
    pin: 'Private folders now open with your PIN',
    password: 'Private folders now open with your lock password',
    account_password: 'Private folders now open with your account password',
};

function useSaveLockSecret(onSaved: (kind: LockSecretKind | null) => void) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (draft: LockSecretDraft) => vaultApi.saveSecret(toSecretRequest(draft)),
        onSuccess: (status, draft) => {
            queryClient.setQueryData(vaultStatusQuery.queryKey, status);
            invalidateLockDependentQueries(queryClient);
            toast.success(SAVED_MESSAGES[draft.choice]);
            onSaved(status.secret_kind);
        },
    });
}

/** Sets, changes or removes the lock secret. `kind` is the one set now. */
export function LockSecretForm({ kind }: { kind: LockSecretKind | null }) {
    const [draft, setDraft] = useState(() => toDraft(kind));
    const [problem, setProblem] = useState<string | null>(null);
    const save = useSaveLockSecret((saved) => setDraft(toDraft(saved)));
    const error = problem ?? (save.error ? getApiErrorMessage(save.error, 'Could not save. Try again.') : null);
    const isChange = draft.choice !== 'account_password' || kind !== null;

    const change = (next: Partial<LockSecretDraft>) => {
        setDraft((last) => ({ ...last, ...next }));
        setProblem(null);
        save.reset();
    };

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();

        if (!isChange || !draft.accountPassword || save.isPending) return;

        const found = toDraftProblem(draft);

        setProblem(found);

        if (!found) save.mutate(draft);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
                <p id="lock-choice" className="text-sm font-medium">
                    Private folders open with
                </p>
                <RadioGroup
                    aria-labelledby="lock-choice"
                    value={draft.choice}
                    onValueChange={(choice) => change({ choice: choice as LockAsk, secret: '', repeat: '' })}
                    className="flex flex-wrap gap-x-6 gap-y-3"
                    disabled={save.isPending}
                >
                    {CHOICES.map(({ value, label }) => (
                        <label key={value} className="flex items-center gap-2 text-sm">
                            <RadioGroupItem value={value} />
                            {label}
                        </label>
                    ))}
                </RadioGroup>
            </div>

            {error && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {isChange && (
                <>
                    {draft.choice !== 'account_password' && <LockSecretFields kind={draft.choice} draft={draft} disabled={save.isPending} onChange={change} />}
                    <LockField id="lock-account-password" label="Account password">
                        <Input
                            id="lock-account-password"
                            type="password"
                            autoComplete="current-password"
                            value={draft.accountPassword}
                            onChange={(event) => change({ accountPassword: event.target.value })}
                            disabled={save.isPending}
                        />
                    </LockField>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                        {draft.choice === 'account_password' ? (
                            <p className="mr-auto text-sm text-muted-foreground">Saving removes your {kind === 'pin' ? 'PIN' : 'lock password'}.</p>
                        ) : (
                            <p className="mr-auto text-sm text-muted-foreground">
                                Don’t reuse a {draft.choice === 'pin' ? 'PIN' : 'password'} that guards something else.
                            </p>
                        )}
                        <Button type="submit" disabled={!draft.accountPassword || save.isPending}>
                            {save.isPending ? 'Saving...' : 'Save'}
                        </Button>
                    </div>
                </>
            )}
        </form>
    );
}

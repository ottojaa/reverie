import type { ApiToken, CreateApiTokenResponse } from '@reverie/shared';
import { KeyRound, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '../../lib/api/api-tokens';
import { formatDate, formatDateTime } from '../../lib/commonhelpers';
import { useConfirm } from '../../lib/confirm';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { NewTokenDialog } from './NewTokenDialog';

function TokenRow({ token, onRevoke, disabled }: { token: ApiToken; onRevoke: (token: ApiToken) => void; disabled: boolean }) {
    return (
        <li className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium">{token.name}</p>
                <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{token.prefix}…</span> · created {formatDate(token.created_at)} ·{' '}
                    {token.last_used_at ? `last used ${formatDateTime(token.last_used_at)}` : 'never used'}
                </p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onRevoke(token)} aria-label={`Revoke ${token.name}`}>
                <Trash2 className="size-4" />
                Revoke
            </Button>
        </li>
    );
}

/** Personal API tokens for connecting an MCP client (Claude Code, Claude Desktop) to the user's own library. */
export function ApiTokensCard() {
    const confirm = useConfirm();
    const { data, isLoading, isError } = useApiTokens();
    const create = useCreateApiToken();
    const revoke = useRevokeApiToken();
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState('');
    const [created, setCreated] = useState<CreateApiTokenResponse | null>(null);

    const handleCreate = async (event: FormEvent) => {
        event.preventDefault();

        const trimmed = name.trim();

        if (!trimmed) return;

        const result = await create.mutateAsync(trimmed).catch(() => null);

        if (!result) return;

        setName('');
        setCreated(result);
    };

    const handleRevoke = async (token: ApiToken) => {
        const ok = await confirm({
            title: `Revoke “${token.name}”?`,
            description: 'Anything using this token stops working immediately. This cannot be undone.',
            confirmText: 'Revoke',
            cancelText: 'Cancel',
        });

        if (ok) revoke.mutate(token.id);
    };

    const tokens = data?.tokens ?? [];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <KeyRound className="size-5" />
                    Library access (MCP)
                </CardTitle>
                <CardDescription>
                    Let Claude Code or another MCP client work on your library with the same tools Reverie uses. A token only ever sees your own library, and
                    never your private items.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        ref={nameInputRef}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Token name, e.g. Laptop"
                        aria-label="Token name"
                        maxLength={100}
                        disabled={create.isPending}
                    />
                    <Button type="submit" disabled={create.isPending || !name.trim()}>
                        {create.isPending ? 'Creating...' : 'Create token'}
                    </Button>
                </form>

                {isError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">Couldn’t load your tokens.</div>}
                {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
                {data && tokens.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
                {tokens.length > 0 && (
                    <ul className="divide-y rounded-md border px-3">
                        {tokens.map((token) => (
                            <TokenRow key={token.id} token={token} onRevoke={handleRevoke} disabled={revoke.isPending} />
                        ))}
                    </ul>
                )}
            </CardContent>
            <NewTokenDialog created={created} onClose={() => setCreated(null)} returnFocusTo={nameInputRef} />
        </Card>
    );
}

import type { VaultStatus } from '@reverie/shared';
import { useQuery } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { LOCK_SETTINGS_ANCHOR, vaultStatusQuery } from '../../lib/api/vault';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { LockSecretForm } from './LockSecretForm';

function toInUse({ ask, secret_kind }: VaultStatus): string {
    if (ask === 'pin') return 'They open with your PIN now.';

    if (ask === 'password') return 'They open with your lock password now.';

    if (!secret_kind) return 'They open with your account password now.';

    const name = secret_kind === 'pin' ? 'PIN' : 'lock password';

    return `Too many wrong tries at your ${name}. Until you enter your account password at a folder, or save here, only that opens them.`;
}

/** What opens private folders, and where to change it. Nothing for an account without a password: nothing locks. */
export function LockSecretCard() {
    // Fetched on every visit: the secret may have been changed or stopped from another device.
    const { data: status } = useQuery({ ...vaultStatusQuery, refetchOnMount: 'always' });

    if (!status?.has_password) return null;

    return (
        <Card id={LOCK_SETTINGS_ANCHOR}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <LockKeyhole className="size-5" />
                    Private folders lock
                </CardTitle>
                <CardDescription>{toInUse(status)}</CardDescription>
            </CardHeader>
            <CardContent>
                <LockSecretForm key={status.secret_kind ?? 'none'} kind={status.secret_kind} />
            </CardContent>
        </Card>
    );
}

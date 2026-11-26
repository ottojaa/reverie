import type { LockAsk, LockSecretKind, VaultSecretRequest } from '@reverie/shared';
import { PIN_LENGTH } from '../vault/PinInput';

const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 128;

/** What the "Private folders lock" form holds. Choosing the account password means having no lock secret. */
export interface LockSecretDraft {
    choice: LockAsk;
    secret: string;
    repeat: string;
    accountPassword: string;
}

export function toDraft(kind: LockSecretKind | null): LockSecretDraft {
    return { choice: kind ?? 'account_password', secret: '', repeat: '', accountPassword: '' };
}

/** What keeps the draft from being saved, as a line to show; null when nothing does. */
export function toDraftProblem({ choice, secret, repeat }: LockSecretDraft): string | null {
    if (choice === 'account_password') return null;

    if (choice === 'pin' && secret.length !== PIN_LENGTH) return 'A PIN is exactly four digits.';

    if (choice === 'password' && secret.length < MIN_PASSWORD_LENGTH) return 'A lock password is 4 to 128 characters.';

    if (secret !== repeat) return choice === 'pin' ? 'The PINs do not match.' : 'The passwords do not match.';

    return null;
}

export function toSecretRequest({ choice, secret, accountPassword }: LockSecretDraft): VaultSecretRequest {
    return { account_password: accountPassword, secret: choice === 'account_password' ? null : { kind: choice, value: secret } };
}

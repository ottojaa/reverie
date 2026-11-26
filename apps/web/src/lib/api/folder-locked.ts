import { VaultRefusalSchema, type LockAsk, type VaultRefusal, type VaultStatus } from '@reverie/shared';
import axios from 'axios';

/**
 * The folder id from a 403 `FOLDER_LOCKED` API error, or null for any other error.
 * The body is `{ error: 'FOLDER_LOCKED', details: { folder_id } }`, where `folder_id` is the
 * private folder whose lock is closed.
 */
export function getLockedFolderId(error: unknown): string | null {
    if (!axios.isAxiosError(error) || error.response?.status !== 403) return null;

    const data: unknown = error.response.data;

    if (typeof data !== 'object' || data === null) return null;

    if (!('error' in data) || data.error !== 'FOLDER_LOCKED') return null;

    if (!('details' in data) || typeof data.details !== 'object' || data.details === null) return null;

    if (!('folder_id' in data.details) || typeof data.details.folder_id !== 'string') return null;

    return data.details.folder_id;
}

export function isFolderLockedError(error: unknown): boolean {
    return getLockedFolderId(error) !== null;
}

export interface UnlockFailure {
    /** What the answer says about the lock, to merge into the cached vault status. */
    status: Partial<Pick<VaultStatus, 'ask' | 'secret_kind'>>;
    /** The line to show with the prompt; null when its new description says it all. */
    message: string | null;
}

const WRONG_ACCOUNT_PASSWORD = 'Incorrect password. Try again.';

/** A refusal once a lock secret is set: it names what to ask for now, and the tries left at it. */
function toRefusalFailure({ ask, tries_left }: VaultRefusal['details'], askedFor: LockAsk): UnlockFailure {
    // Stopped. Whoever was already asked for the account password typed it wrong.
    if (ask === 'account_password') return { status: { ask }, message: askedFor === ask ? WRONG_ACCOUNT_PASSWORD : null };

    const name = ask === 'pin' ? 'PIN' : 'password';
    const tries = tries_left === 1 ? '1 try' : `${tries_left} tries`;

    return { status: { ask, secret_kind: ask }, message: `Incorrect ${name}. ${tries} left.` };
}

function toErrorCode(data: unknown): unknown {
    return typeof data === 'object' && data !== null && 'error' in data ? data.error : undefined;
}

/** What a failed `POST /vault/unlock` means for a prompt that asked for `askedFor`. */
export function toUnlockFailure(error: unknown, askedFor: LockAsk): UnlockFailure {
    const data: unknown = axios.isAxiosError(error) ? error.response?.data : undefined;
    const refusal = VaultRefusalSchema.safeParse(data);

    if (refusal.success) return toRefusalFailure(refusal.data.details, askedFor);

    // Without a lock secret, a wrong account password is answered with the code alone.
    if (toErrorCode(data) === 'invalid_credentials') {
        return { status: { ask: 'account_password', secret_kind: null }, message: askedFor === 'account_password' ? WRONG_ACCOUNT_PASSWORD : null };
    }

    if (toErrorCode(data) === 'no_password') {
        return { status: {}, message: 'Your account has no password yet. Set one in Settings to lock and unlock private folders.' };
    }

    return { status: {}, message: 'Could not unlock this folder. Try again.' };
}

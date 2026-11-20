import axios from 'axios';

/**
 * The folder id from a 403 `FOLDER_LOCKED` API error, or null for any other error.
 * The body is `{ error: 'FOLDER_LOCKED', details: { folder_id } }`, where `folder_id` is the
 * private folder (or collection) whose lock is closed.
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

/** Message for a failed `POST /vault/unlock`, keyed off the API's `error` code. */
export function toUnlockErrorMessage(error: unknown): string {
    const code = axios.isAxiosError(error) && typeof error.response?.data === 'object' ? (error.response.data as { error?: unknown } | null)?.error : undefined;

    if (code === 'invalid_credentials') return 'Incorrect password. Try again.';

    if (code === 'no_password') return 'Your account has no password yet. Set one in Settings to lock and unlock private folders.';

    return 'Could not unlock this folder. Try again.';
}

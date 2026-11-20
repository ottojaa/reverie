import { getLockedFolderId } from '@/lib/api/folder-locked';
import { useVault } from '@/lib/vault';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Handles a query that failed with 403 FOLDER_LOCKED (deep link, reload, stale tab): asks for
 * the password once for the locked folder. A successful unlock refetches the lock-dependent
 * queries, so the failed one recovers on its own. `unlock` re-opens the prompt after a cancel.
 */
export function useLockedFolderPrompt(error: unknown) {
    const { requestUnlock } = useVault();
    const lockedFolderId = getLockedFolderId(error);
    const promptedForRef = useRef<string | null>(null);

    const unlock = useCallback(() => {
        if (!lockedFolderId) return;

        void requestUnlock(lockedFolderId);
    }, [lockedFolderId, requestUnlock]);

    useEffect(() => {
        if (!lockedFolderId) {
            promptedForRef.current = null;

            return;
        }

        if (promptedForRef.current === lockedFolderId) return;

        promptedForRef.current = lockedFolderId;
        unlock();
    }, [lockedFolderId, unlock]);

    return { isLocked: lockedFolderId !== null, unlock };
}

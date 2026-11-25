import { getLockedFolderId } from '../api/folder-locked.js';

/**
 * Runs `run`, and when the server refuses because a folder is locked, asks to unlock that folder and runs it
 * again. One request can need two locks open in turn; each folder is asked about once.
 */
export async function runUnlocking<T>(
    run: () => Promise<T>,
    requestUnlock: (folderId: string) => Promise<boolean>,
    asked: ReadonlySet<string> = new Set(),
): Promise<T> {
    try {
        return await run();
    } catch (error) {
        const folderId = getLockedFolderId(error);

        if (!folderId || asked.has(folderId) || !(await requestUnlock(folderId))) throw error;

        return runUnlocking(run, requestUnlock, new Set([...asked, folderId]));
    }
}

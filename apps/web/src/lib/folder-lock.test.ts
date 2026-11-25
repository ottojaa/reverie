import { describe, expect, it } from 'vitest';
import { toFolderLockState } from './folder-lock.js';

describe('toFolderLockState', () => {
    it('shows a closed padlock for a locked folder', () => {
        expect(toFolderLockState({ is_private: true, locked: true })).toBe('locked');
    });

    it('shows an open padlock for a private folder whose lock is open', () => {
        expect(toFolderLockState({ is_private: true, locked: false })).toBe('unlocked');
    });

    it('shows nothing for a public folder', () => {
        expect(toFolderLockState({ is_private: false, locked: false })).toBe('none');
    });

    it('treats a folder locked through a folder above it as locked even without its own flag', () => {
        expect(toFolderLockState({ is_private: false, locked: true })).toBe('locked');
    });
});

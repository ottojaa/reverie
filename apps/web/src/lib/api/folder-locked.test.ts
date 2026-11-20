import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';
import { getLockedFolderId, isFolderLockedError, toUnlockErrorMessage } from './folder-locked.js';

function toAxiosError(status: number, data: unknown): AxiosError {
    const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() };

    return new AxiosError('request failed', String(status), config, undefined, { status, statusText: '', headers: {}, config, data });
}

const lockedBody = { statusCode: 403, error: 'FOLDER_LOCKED', message: 'This folder is locked', details: { folder_id: 'f-1' } };

describe('getLockedFolderId', () => {
    it('reads the folder id from a 403 FOLDER_LOCKED response', () => {
        expect(getLockedFolderId(toAxiosError(403, lockedBody))).toBe('f-1');
        expect(isFolderLockedError(toAxiosError(403, lockedBody))).toBe(true);
    });

    it('ignores other 403s, other statuses and malformed bodies', () => {
        expect(getLockedFolderId(toAxiosError(403, { error: 'FORBIDDEN' }))).toBeNull();
        expect(getLockedFolderId(toAxiosError(401, lockedBody))).toBeNull();
        expect(getLockedFolderId(toAxiosError(403, { error: 'FOLDER_LOCKED' }))).toBeNull();
        expect(getLockedFolderId(toAxiosError(403, { error: 'FOLDER_LOCKED', details: { folder_id: 7 } }))).toBeNull();
        expect(getLockedFolderId(toAxiosError(403, 'nope'))).toBeNull();
        expect(getLockedFolderId(toAxiosError(403, null))).toBeNull();
    });

    it('ignores errors that are not axios errors', () => {
        expect(getLockedFolderId(new Error('boom'))).toBeNull();
        expect(getLockedFolderId(undefined)).toBeNull();
    });
});

describe('toUnlockErrorMessage', () => {
    it('explains a wrong password and a missing account password', () => {
        expect(toUnlockErrorMessage(toAxiosError(401, { error: 'invalid_credentials' }))).toContain('Incorrect password');
        expect(toUnlockErrorMessage(toAxiosError(400, { error: 'no_password' }))).toContain('Set one in Settings');
    });

    it('falls back to a generic message', () => {
        expect(toUnlockErrorMessage(toAxiosError(404, { error: 'NOT_FOUND' }))).toContain('Could not unlock');
        expect(toUnlockErrorMessage(new Error('network'))).toContain('Could not unlock');
    });
});

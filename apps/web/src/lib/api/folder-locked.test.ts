import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';
import { getLockedFolderId, isFolderLockedError, toUnlockFailure } from './folder-locked.js';

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

describe('toUnlockFailure', () => {
    const refused = (ask: string, tries_left: number | null) =>
        toAxiosError(403, { statusCode: 403, error: 'invalid_credentials', message: 'x', details: { ask, tries_left } });

    it.each([
        ['pin', 7, 'Incorrect PIN. 7 tries left.'],
        ['pin', 1, 'Incorrect PIN. 1 try left.'],
        ['password', 9, 'Incorrect password. 9 tries left.'],
    ] as const)('counts down a wrong %s with %i left', (ask, left, message) => {
        expect(toUnlockFailure(refused(ask, left), ask)).toEqual({ status: { ask, secret_kind: ask }, message });
    });

    it('names the kind the server asks for now, whatever was asked', () => {
        expect(toUnlockFailure(refused('password', 3), 'pin').status).toEqual({ ask: 'password', secret_kind: 'password' });
    });

    it('turns to the account password when stopped, keeping which secret is set', () => {
        expect(toUnlockFailure(refused('account_password', null), 'pin')).toEqual({ status: { ask: 'account_password' }, message: null });
        expect(toUnlockFailure(refused('account_password', null), 'account_password').message).toBe('Incorrect password. Try again.');
    });

    it('takes a 401 to mean no lock secret is set', () => {
        const wrong = toAxiosError(401, { error: 'invalid_credentials', message: 'Incorrect password' });
        const noSecret = { ask: 'account_password', secret_kind: null };

        expect(toUnlockFailure(wrong, 'account_password')).toEqual({ status: noSecret, message: 'Incorrect password. Try again.' });
        expect(toUnlockFailure(wrong, 'pin')).toEqual({ status: noSecret, message: null });
    });

    it('explains a missing account password and anything else', () => {
        expect(toUnlockFailure(toAxiosError(400, { error: 'no_password' }), 'account_password').message).toContain('Set one in Settings');
        expect(toUnlockFailure(toAxiosError(404, { error: 'NOT_FOUND' }), 'pin').message).toContain('Could not unlock');
        expect(toUnlockFailure(new Error('network'), 'pin').message).toContain('Could not unlock');
    });
});

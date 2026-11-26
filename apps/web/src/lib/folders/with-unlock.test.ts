import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { runUnlocking } from './with-unlock.js';

function toLockedError(folderId: string): AxiosError {
    const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() };
    const data = { error: 'FOLDER_LOCKED', details: { folder_id: folderId } };

    return new AxiosError('request failed', '403', config, undefined, { status: 403, statusText: '', headers: {}, config, data });
}

describe('runUnlocking', () => {
    it('unlocks the folder the server names and runs again', async () => {
        const run = vi.fn<() => Promise<string>>().mockRejectedValueOnce(toLockedError('a')).mockResolvedValue('moved');
        const requestUnlock = vi.fn(() => Promise.resolve(true));

        await expect(runUnlocking(run, requestUnlock)).resolves.toBe('moved');
        expect(requestUnlock).toHaveBeenCalledWith('a');
    });

    it('asks for each lock a request needs', async () => {
        const run = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(toLockedError('a'))
            .mockRejectedValueOnce(toLockedError('b'))
            .mockResolvedValue('moved');
        const requestUnlock = vi.fn(() => Promise.resolve(true));

        await expect(runUnlocking(run, requestUnlock)).resolves.toBe('moved');
        expect(requestUnlock.mock.calls).toEqual([['a'], ['b']]);
    });

    it('gives up when the unlock is cancelled', async () => {
        const run = vi.fn<() => Promise<string>>().mockRejectedValue(toLockedError('a'));

        await expect(runUnlocking(run, () => Promise.resolve(false))).rejects.toBeInstanceOf(AxiosError);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('asks about a folder only once', async () => {
        const run = vi.fn<() => Promise<string>>().mockRejectedValue(toLockedError('a'));
        const requestUnlock = vi.fn(() => Promise.resolve(true));

        await expect(runUnlocking(run, requestUnlock)).rejects.toBeInstanceOf(AxiosError);
        expect(requestUnlock).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('passes other errors through', async () => {
        const requestUnlock = vi.fn(() => Promise.resolve(true));

        await expect(runUnlocking(() => Promise.reject(new Error('boom')), requestUnlock)).rejects.toThrow('boom');
        expect(requestUnlock).not.toHaveBeenCalled();
    });
});

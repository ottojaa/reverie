// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../testing/render';
import { AuthProvider, useAuth } from './auth';

let session: ReturnType<typeof useAuth>;

function ReadSession() {
    session = useAuth();

    return null;
}

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('{}'))),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// The app mounts AuthProvider above the router, so it must work without one.
describe('AuthProvider outside the router', () => {
    it('mounts and signs out with nothing on the console', async () => {
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        localStorage.setItem('reverie_access_token', 'token');
        localStorage.setItem('reverie_user', '{}');
        const view = mount(createElement(AuthProvider, null, createElement(ReadSession)));
        await settle();

        await act(() => session.logout());

        expect(session.isAuthenticated).toBe(false);
        expect(localStorage.getItem('reverie_access_token')).toBeNull();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        view.unmount();
    });
});

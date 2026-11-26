// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from '../routes/__root';
import { mount, settle } from '../testing/render';
import { apiClient } from './api/client';
import { AuthProvider, useAuth } from './auth';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
    createRootRoute: (options: object) => ({ options }),
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: '/settings' }),
    useMatches: () => [],
    Outlet: () => null,
}));
vi.mock('../components/canvas/dive/returnShield', () => ({ useCanvasReturnShield: () => {} }));
vi.mock('../components/layout/Layout', () => ({ Layout: () => null }));
vi.mock('../lib/hooks/useNavigationDirection', () => ({ usePathnameTracker: () => {} }));
vi.mock('../lib/upload', () => ({ UploadProvider: () => null }));

const LOGIN_WITH_REASON = { to: '/login', search: { error: 'unauthorized_access' }, replace: true };

const server = { isSessionValid: true, isRefreshValid: true, releaseLogout: Promise.resolve() };

let session: ReturnType<typeof useAuth>;
let view: ReturnType<typeof mount>;

function ReadSession() {
    session = useAuth();

    return null;
}

async function respond(url: string): Promise<Response> {
    if (url.endsWith('/auth/refresh')) return server.isRefreshValid ? Response.json({ access_token: 'renewed' }) : new Response('{}', { status: 401 });

    if (url.endsWith('/auth/login')) return Response.json({ access_token: 'token', user: {} });

    if (url.endsWith('/auth/logout')) {
        await server.releaseLogout;

        return new Response('{}');
    }

    return server.isSessionValid ? Response.json({ user: {} }) : new Response('{}', { status: 401 });
}

/** A request of the app's own, answered the way the server answers it once the session is gone. */
function requestWithDeadSession() {
    return apiClient
        .get('/documents', {
            adapter: (config) => Promise.reject(Object.assign(new Error('Unauthorized'), { config, response: { status: 401, data: {} } })),
        })
        .catch(() => {});
}

/** The app's root around a signed-in session. */
async function mountSignedIn() {
    localStorage.setItem('reverie_access_token', 'token');
    localStorage.setItem('reverie_user', '{}');
    const Root = Route.options.component as ComponentType;
    view = mount(createElement(AuthProvider, null, createElement(ReadSession), createElement(Root)));
    await settle(10);
}

function lastRedirect() {
    return navigate.mock.lastCall?.[0] as { to: string; search?: { error?: string } } | undefined;
}

beforeEach(() => {
    localStorage.clear();
    navigate.mockClear();
    Object.assign(server, { isSessionValid: true, isRefreshValid: true, releaseLogout: Promise.resolve() });
    vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => respond(url)),
    );
});

afterEach(() => {
    view.unmount();
    vi.unstubAllGlobals();
});

describe('where a session that ends lands', () => {
    it('is the login page with no error after signing out', async () => {
        await mountSignedIn();

        await act(() => session.logout());
        await settle(10);

        expect(lastRedirect()?.to).toBe('/login');
        expect(lastRedirect()?.search?.error).toBeUndefined();
    });

    it('stays without an error when a request is rejected while signing out', async () => {
        await mountSignedIn();

        let release = () => {};

        server.releaseLogout = new Promise<void>((resolve) => (release = resolve));
        let signingOut = Promise.resolve();
        await act(async () => void (signingOut = session.logout()));
        server.isRefreshValid = false;
        let rejected = Promise.resolve<unknown>(undefined);
        await act(async () => void (rejected = requestWithDeadSession()));
        await settle(10);

        await act(async () => release());
        await act(() => Promise.all([signingOut, rejected]).then(() => {}));
        await settle(10);

        expect(lastRedirect()?.to).toBe('/login');
        expect(navigate.mock.calls.filter(([to]) => (to as { search?: { error?: string } }).search?.error)).toEqual([]);
    });

    it('says why when the session expires while the app is open', async () => {
        await mountSignedIn();
        server.isRefreshValid = false;

        await act(() => requestWithDeadSession().then(() => {}));
        await settle(10);

        expect(lastRedirect()).toEqual(LOGIN_WITH_REASON);
    });

    it('says why when the stored session has expired on load', async () => {
        server.isSessionValid = false;
        server.isRefreshValid = false;

        await mountSignedIn();

        expect(lastRedirect()).toEqual(LOGIN_WITH_REASON);
    });

    it('says why when a session begun after a sign-out expires', async () => {
        await mountSignedIn();
        await act(() => session.logout());
        await act(() => session.login('check@example.test', 'password'));
        server.isRefreshValid = false;

        await act(() => requestWithDeadSession().then(() => {}));
        await settle(10);

        expect(lastRedirect()).toEqual(LOGIN_WITH_REASON);
    });
});

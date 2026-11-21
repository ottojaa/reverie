import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(
    () =>
        ({
            JWT_SECRET: 's'.repeat(32),
            JWT_ACCESS_EXPIRES: '15m',
            JWT_REFRESH_EXPIRES: '7d',
            NODE_ENV: 'test',
            PORT: 3000,
            CORS_ORIGIN: 'http://localhost:4200',
        }) as Record<string, unknown>,
);

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env }));

import { MOCK_CLIENT_SECRET, startMockOidc, type MockOidc, type MockPerson } from '../testing/mock-oidc-provider.js';
import { down, up } from '../db/migrations/025_user_identities.js';
import { seedUser } from '../testing/seed.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import authRoute from './routes/auth.route.js';
import oidcRoute from './routes/oidc.route.js';

const CORS_ORIGIN = 'http://localhost:4200';
const API = 'http://localhost:3000';

async function buildApp(config: Record<string, unknown>): Promise<FastifyInstance> {
    for (const key of ['OIDC_PROVIDERS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'API_PUBLIC_URL']) delete env[key];

    Object.assign(env, { API_PUBLIC_URL: API, ...config });

    const app = Fastify();

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(sensible);
    await app.register(authPlugin);
    await app.register(errorHandler);
    await app.register(authRoute);
    await app.register(oidcRoute);
    await app.ready();

    return app;
}

const providerEntry = (id: string, name: string, mock: MockOidc, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    issuer: mock.issuer,
    clientId: mock.clientId,
    clientSecret: mock.clientSecret,
    ...extra,
});

/** One browser: carries cookies between requests, follows nothing on its own. */
class Browser {
    private cookies = new Map<string, string>();

    constructor(private readonly app: FastifyInstance) {}

    cookie(name: string): string | undefined {
        return this.cookies.get(name);
    }

    async get(url: string, headers: Record<string, string> = {}) {
        const cookie = Array.from(this.cookies, ([name, value]) => name + '=' + value).join('; ');
        const response = await this.app.inject({ method: 'GET', url, headers: { ...(cookie ? { cookie } : {}), ...headers } });
        const setCookies = [response.headers['set-cookie']].flat().filter((value): value is string => Boolean(value));

        for (const set of setCookies) {
            const [pair = ''] = set.split(';');
            const [name = '', ...value] = pair.split('=');

            if (value.join('=') === '' || /expires=Thu, 01 Jan 1970/i.test(set)) this.cookies.delete(name);
            else this.cookies.set(name, value.join('='));
        }

        return { status: response.statusCode, location: response.headers.location as string | undefined, setCookies, body: response.body };
    }
}

describeDb('OpenID Connect sign-in routes', () => {
    const { world } = useWorld();
    let mock: MockOidc;
    let second: MockOidc;
    let app: FastifyInstance | undefined;
    let n = 0;

    beforeAll(async () => {
        mock = await startMockOidc({ clientId: 'client-one' });
        second = await startMockOidc({ clientId: 'client-two' });
    });
    afterAll(async () => {
        await mock.close();
        await second.close();
    });
    beforeEach(async () => {
        mock.person = { sub: 'sub-1', email: 'nobody@example.test', email_verified: true };
        mock.next = {};
        second.person = { sub: 'sub-1', email: 'nobody@example.test', email_verified: true };
        second.next = {};
        await world().db.deleteFrom('user_identities').execute();
    });
    afterEach(async () => {
        await app?.close();
        app = undefined;
        vi.unstubAllGlobals();
    });

    const newUser = async (patch: { google_id?: string; is_active?: boolean } = {}) => {
        const label = 'oidc-user-' + ++n;
        const id = await seedUser(world().db, label);

        if (Object.keys(patch).length > 0) await world().db.updateTable('users').set(patch).where('id', '=', id).execute();

        return { id, email: label + '@example.test' };
    };

    const userCount = async () =>
        Number(
            (
                await world()
                    .db.selectFrom('users')
                    .select((eb) => eb.fn.countAll().as('n'))
                    .executeTakeFirstOrThrow()
            ).n,
        );
    const identities = () => world().db.selectFrom('user_identities').selectAll().execute();

    /** Click "sign in with <provider>", sign in at the provider, and land on the callback. */
    async function signIn(browser: Browser, provider: MockOidc, startPath: string, person?: MockPerson) {
        if (person) provider.person = person;

        let start = await browser.get(startPath);

        // `/auth/google` hands the browser on to the generic route within this server.
        while (start.location?.startsWith('/')) start = await browser.get(start.location);

        expect(start.status).toBe(302);

        const back = new URL(await provider.authorize(start.location ?? ''));
        const callback = await browser.get(back.pathname + back.search);

        return { start, back, callback };
    }

    const exchange = (code: string) => app!.inject({ method: 'POST', url: '/auth/exchange-oauth-code', payload: { code } });

    describe('signing in', () => {
        it('signs a known person in, and the code from the redirect buys a working access token, once', async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock)]) });

            const user = await newUser();
            const browser = new Browser(app);
            const { callback } = await signIn(browser, mock, '/auth/oidc/mock', { sub: 'sub-happy', email: user.email, email_verified: true });
            const target = new URL(callback.location ?? '');

            expect(callback.status).toBe(302);
            expect(target.origin + target.pathname).toBe(CORS_ORIGIN + '/login/callback');
            expect(browser.cookie('refresh_token')).toBeTruthy();

            const code = target.searchParams.get('code') ?? '';
            const exchanged = await exchange(code);

            expect(exchanged.statusCode).toBe(200);

            const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Bearer ' + exchanged.json().access_token } });

            expect(me.json().user.id).toBe(user.id);
            expect((await exchange(code)).statusCode).toBe(400);
            expect(await identities()).toMatchObject([{ user_id: user.id, provider: 'mock', subject: 'sub-happy' }]);
        });

        it('keeps the flow cookie httpOnly, scoped to /auth and short-lived, and spends it at the callback', async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock)]) });

            const browser = new Browser(app);
            const { start, callback } = await signIn(browser, mock, '/auth/oidc/mock');
            const flow = start.setCookies.find((set) => set.startsWith('oidc_flow='));

            expect(flow).toMatch(/HttpOnly/i);
            expect(flow).toMatch(/Path=\/auth(;|$)/);
            expect(flow).toMatch(/SameSite=Lax/i);
            expect(flow).toMatch(/Max-Age=600/);
            expect(browser.cookie('oidc_flow')).toBeUndefined();
            expect(callback.setCookies.some((set) => set.startsWith('oidc_flow=;'))).toBe(true);
        });

        it('sends PKCE and the registered redirect URI in the authorization request', async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock)]) });
            mock.authorizeRequests.length = 0;

            await signIn(new Browser(app), mock, '/auth/oidc/mock');

            const request = mock.authorizeRequests[0];

            expect(request?.get('code_challenge_method')).toBe('S256');
            expect(request?.get('code_challenge')).toBeTruthy();
            expect(request?.get('redirect_uri')).toBe(API + '/auth/oidc/mock/callback');
            expect(request?.get('client_id')).toBe('client-one');
        });

        it('does not sign in a person who is not an account, and creates no account', async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock)]) });

            const before = await userCount();
            const browser = new Browser(app);
            const { callback } = await signIn(browser, mock, '/auth/oidc/mock', { sub: 'stranger', email: 'stranger@example.test', email_verified: true });

            expect(callback.location).toBe(CORS_ORIGIN + '/login?error=oidc_account_not_linked');
            expect(browser.cookie('refresh_token')).toBeUndefined();
            expect(await userCount()).toBe(before);
            expect(await identities()).toEqual([]);
        });

        it('does not sign in a deactivated account, whether linked or matched by email', async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock)]) });

            const byEmail = await newUser({ is_active: false });
            const linked = await newUser({ is_active: false });

            await world().db.insertInto('user_identities').values({ user_id: linked.id, provider: 'mock', subject: 'sub-linked' }).execute();

            const first = await signIn(new Browser(app), mock, '/auth/oidc/mock', { sub: 'sub-by-email', email: byEmail.email, email_verified: true });
            const second = await signIn(new Browser(app), mock, '/auth/oidc/mock', { sub: 'sub-linked', email: 'other@example.test', email_verified: true });

            expect(first.callback.location).toContain('oidc_account_not_linked');
            expect(second.callback.location).toContain('oidc_account_not_linked');
            expect(await identities()).toHaveLength(1);
        });
    });

    describe('what the browser callback refuses', () => {
        beforeEach(async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock)]) });
        });

        const failed = (response: { location?: string | undefined }) => expect(response.location).toBe(CORS_ORIGIN + '/login?error=oidc_auth_failed');

        it('a callback whose state is not the one this browser started with', async () => {
            const user = await newUser();
            const browser = new Browser(app!);

            mock.person = { sub: 'sub-s', email: user.email, email_verified: true };

            const start = await browser.get('/auth/oidc/mock');
            const back = new URL(await mock.authorize(start.location ?? ''));

            back.searchParams.set('state', 'attacker-state');
            failed(await browser.get(back.pathname + back.search));
            expect(browser.cookie('refresh_token')).toBeUndefined();
            expect(await identities()).toEqual([]);
        });

        it('a callback from a browser that never started a sign-in', async () => {
            const user = await newUser();

            mock.person = { sub: 'sub-s', email: user.email, email_verified: true };

            const start = await new Browser(app!).get('/auth/oidc/mock');
            const back = new URL(await mock.authorize(start.location ?? ''));
            const elsewhere = new Browser(app!);

            failed(await elsewhere.get(back.pathname + back.search));
            expect(elsewhere.cookie('refresh_token')).toBeUndefined();
        });

        it('a flow cookie that this server did not sign', async () => {
            const browser = new Browser(app!);
            const start = await browser.get('/auth/oidc/mock');
            const back = new URL(await mock.authorize(start.location ?? ''));
            const forged = encodeURIComponent(
                JSON.stringify({ provider: 'mock', state: back.searchParams.get('state'), nonce: 'n', verifier: 'v'.repeat(43) }),
            );

            failed(await new Browser(app!).get(back.pathname + back.search, { cookie: 'oidc_flow=' + forged }));
        });

        it('a token with the wrong nonce, audience or issuer, an expired one, or one signed by an unknown key', async () => {
            const user = await newUser();

            for (const bend of [
                { nonce: 'other' },
                { aud: 'another-client' },
                { iss: 'https://evil.example.com' },
                { expiresIn: -3600 },
                { signWithStrangerKey: true },
            ]) {
                mock.next = bend;

                const browser = new Browser(app!);
                const { callback } = await signIn(browser, mock, '/auth/oidc/mock', { sub: 'sub-bad', email: user.email, email_verified: true });

                failed(callback);
                expect(browser.cookie('refresh_token')).toBeUndefined();
            }

            expect(await identities()).toEqual([]);
        });

        it('an error answer from the provider', async () => {
            const browser = new Browser(app!);

            await browser.get('/auth/oidc/mock');
            failed(await browser.get('/auth/oidc/mock/callback?error=access_denied'));
        });

        it('a provider that is not configured', async () => {
            expect((await new Browser(app!).get('/auth/oidc/nope')).status).toBe(404);
            expect((await new Browser(app!).get('/auth/oidc/nope/callback?code=x')).status).toBe(404);
        });

        it('a flow started for one provider, finished at another', async () => {
            await app!.close();
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock), providerEntry('other', 'Other', second)]) });

            const browser = new Browser(app);
            const start = await browser.get('/auth/oidc/mock');
            const back = new URL(await mock.authorize(start.location ?? ''));

            failed(await browser.get('/auth/oidc/other/callback' + back.search));
        });
    });

    describe('which account a provider sign-in belongs to', () => {
        beforeEach(async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('mock', 'Mock', mock)]) });
        });

        it('never links on an unverified email, or one with no verification claim', async () => {
            const user = await newUser();

            for (const email_verified of [false, undefined]) {
                const browser = new Browser(app!);
                const { callback } = await signIn(browser, mock, '/auth/oidc/mock', {
                    sub: 'sub-u',
                    email: user.email,
                    ...(email_verified === undefined ? {} : { email_verified }),
                });

                expect(callback.location).toBe(CORS_ORIGIN + '/login?error=oidc_account_not_linked');
                expect(browser.cookie('refresh_token')).toBeUndefined();
            }

            expect(await identities()).toEqual([]);
        });

        it('links a verified email once, ignoring the case of the address', async () => {
            const user = await newUser();
            const { callback } = await signIn(new Browser(app!), mock, '/auth/oidc/mock', {
                sub: 'sub-v',
                email: user.email.toUpperCase(),
                email_verified: true,
            });

            expect(callback.location).toContain('/login/callback?code=');
            expect(await identities()).toMatchObject([{ user_id: user.id, provider: 'mock', subject: 'sub-v' }]);
        });

        it('recognises a linked person by subject even when their email has changed', async () => {
            const user = await newUser();

            await signIn(new Browser(app!), mock, '/auth/oidc/mock', { sub: 'sub-r', email: user.email, email_verified: true });

            const again = await signIn(new Browser(app!), mock, '/auth/oidc/mock', { sub: 'sub-r', email: 'renamed@example.test', email_verified: false });

            expect(again.callback.location).toContain('/login/callback?code=');
            expect(await identities()).toHaveLength(1);
        });

        it('does not let a second subject take over an account already linked to the provider', async () => {
            const user = await newUser();

            await signIn(new Browser(app!), mock, '/auth/oidc/mock', { sub: 'sub-owner', email: user.email, email_verified: true });

            const intruder = await signIn(new Browser(app!), mock, '/auth/oidc/mock', { sub: 'sub-intruder', email: user.email, email_verified: true });

            expect(intruder.callback.location).toContain('oidc_account_not_linked');
            expect(await identities()).toMatchObject([{ subject: 'sub-owner' }]);
        });

        it('reads the email facts from userinfo when the ID token has none', async () => {
            const user = await newUser();

            mock.next = { emailInUserinfoOnly: true };

            const { callback } = await signIn(new Browser(app!), mock, '/auth/oidc/mock', { sub: 'sub-i', email: user.email, email_verified: true });

            expect(callback.location).toContain('/login/callback?code=');
        });
    });

    describe('two providers at once', () => {
        it('lists both, signs in through each, and keeps their subjects apart', async () => {
            app = await buildApp({
                OIDC_PROVIDERS: JSON.stringify([providerEntry('one', 'Provider One', mock), providerEntry('two', 'Provider Two', second)]),
            });

            const listed = await app.inject({ method: 'GET', url: '/auth/oidc/providers' });

            expect(listed.json()).toEqual({
                providers: [
                    { id: 'one', name: 'Provider One' },
                    { id: 'two', name: 'Provider Two' },
                ],
            });

            const alice = await newUser();
            const bob = await newUser();
            // The same subject string at two providers is two different people.
            const viaOne = await signIn(new Browser(app), mock, '/auth/oidc/one', { sub: 'same-sub', email: alice.email, email_verified: true });
            const viaTwo = await signIn(new Browser(app), second, '/auth/oidc/two', { sub: 'same-sub', email: bob.email, email_verified: true });

            expect(viaOne.callback.location).toContain('/login/callback?code=');
            expect(viaTwo.callback.location).toContain('/login/callback?code=');
            expect(
                (await identities())
                    .map(({ user_id, provider, subject }) => ({ user_id, provider, subject }))
                    .sort((a, b) => a.provider.localeCompare(b.provider)),
            ).toEqual([
                { user_id: alice.id, provider: 'one', subject: 'same-sub' },
                { user_id: bob.id, provider: 'two', subject: 'same-sub' },
            ]);
            expect(viaOne.back.pathname).toBe('/auth/oidc/one/callback');
            expect(viaTwo.back.pathname).toBe('/auth/oidc/two/callback');
        });

        it('does not expose secrets or issuers on the public list', async () => {
            app = await buildApp({ OIDC_PROVIDERS: JSON.stringify([providerEntry('one', 'Provider One', mock)]) });

            const raw = (await app.inject({ method: 'GET', url: '/auth/oidc/providers' })).body;

            expect(raw).not.toContain(mock.clientSecret);
            expect(raw).not.toContain(mock.issuer);
        });
    });

    describe('the user_identities table', () => {
        it('holds a subject once per provider and one subject per user and provider, and goes with its user', async () => {
            const { db } = world();
            const first = await newUser();
            const second = await newUser();
            const link = (user_id: string, provider: string, subject: string) =>
                db.insertInto('user_identities').values({ user_id, provider, subject }).execute();

            await link(first.id, 'p', 's1');
            await expect(link(second.id, 'p', 's1')).rejects.toThrow();
            await expect(link(first.id, 'p', 's2')).rejects.toThrow();
            await link(first.id, 'q', 's1');

            await db.deleteFrom('users').where('id', '=', first.id).execute();
            expect(await identities()).toEqual([]);
        });

        it('migrates down and up again, leaving users alone', async () => {
            const { db } = world();
            const user = await newUser({ google_id: 'kept' });

            await down(db as never);
            await expect(identities()).rejects.toThrow();
            await up(db as never);
            expect(await identities()).toEqual([]);
            expect((await db.selectFrom('users').select('google_id').where('id', '=', user.id).executeTakeFirstOrThrow()).google_id).toBe('kept');
        });
    });

    describe('the existing Google sign-in', () => {
        const GOOGLE_CALLBACK_URL = 'https://api.reverieapp.dev/auth/google/callback';
        let google: MockOidc;

        beforeAll(async () => {
            google = await startMockOidc({ clientId: 'google-client-id', publicUrl: 'https://accounts.google.com' });
        });
        afterAll(() => google.close());
        beforeEach(() => {
            // Google's address is answered by the local provider.
            const realFetch = fetch;

            vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
                const url = input instanceof Request ? input.url : String(input);

                return realFetch(url.startsWith(google.issuer) ? google.origin + url.slice(google.issuer.length) : input, init);
            });
        });

        const googleEnv = { GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: MOCK_CLIENT_SECRET, GOOGLE_CALLBACK_URL };

        it('works from the GOOGLE_* variables alone, with the same client and callback URL as before', async () => {
            app = await buildApp(googleEnv);

            expect((await app.inject({ method: 'GET', url: '/auth/oidc/providers' })).json()).toEqual({ providers: [{ id: 'google', name: 'Google' }] });

            const redirect = await app.inject({ method: 'GET', url: '/auth/google' });

            expect(redirect.statusCode).toBe(302);
            expect(redirect.headers.location).toBe('/auth/oidc/google');

            google.authorizeRequests.length = 0;

            const browser = new Browser(app);
            const user = await newUser();
            const { callback } = await signIn(browser, google, '/auth/oidc/google', { sub: 'google-sub-1', email: user.email, email_verified: true });
            const request = google.authorizeRequests[0];

            expect(request?.get('client_id')).toBe('google-client-id');
            expect(request?.get('redirect_uri')).toBe(GOOGLE_CALLBACK_URL);
            expect(callback.location).toContain(CORS_ORIGIN + '/login/callback?code=');
        });

        it('is the same user after the change: found by users.google_id, then linked by (google, sub)', async () => {
            app = await buildApp(googleEnv);

            const user = await newUser({ google_id: 'google-sub-legacy' });
            // Registered callback path of the old flow, reached by the redirect Google sends.
            const { start, back, callback } = await signIn(new Browser(app), google, '/auth/google', {
                sub: 'google-sub-legacy',
                email: 'different-address@example.test',
                email_verified: false,
            });

            expect(start.location).toContain(google.issuer + '/authorize');
            expect(back.pathname).toBe('/auth/google/callback');
            expect(callback.location).toContain('/login/callback?code=');
            expect(await identities()).toMatchObject([{ user_id: user.id, provider: 'google', subject: 'google-sub-legacy' }]);

            // Next time the link is enough, without the legacy column.
            await world().db.updateTable('users').set({ google_id: null }).where('id', '=', user.id).execute();

            const again = await signIn(new Browser(app), google, '/auth/oidc/google', {
                sub: 'google-sub-legacy',
                email: 'x@example.test',
                email_verified: false,
            });

            expect(again.callback.location).toContain('/login/callback?code=');
        });

        it('turns an unknown Google account away with no account created', async () => {
            app = await buildApp(googleEnv);

            const before = await userCount();
            const { callback } = await signIn(new Browser(app), google, '/auth/oidc/google', {
                sub: 'google-stranger',
                email: 'stranger@gmail.test',
                email_verified: true,
            });

            expect(callback.location).toBe(CORS_ORIGIN + '/login?error=oidc_account_not_linked');
            expect(await userCount()).toBe(before);
        });

        it('has no sign-in routes to offer when Google is not configured', async () => {
            app = await buildApp({});

            expect((await app.inject({ method: 'GET', url: '/auth/oidc/providers' })).json()).toEqual({ providers: [] });
            expect((await app.inject({ method: 'GET', url: '/auth/oidc/google' })).statusCode).toBe(404);
        });
    });
});

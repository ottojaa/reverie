import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockOidc, type MockOidc } from '../testing/mock-oidc-provider.js';
import { createOidcClient, type OidcClient, type OidcFlowState } from './oidc-client.js';
import type { OidcProvider } from './providers.js';

/** The OpenID Connect flow against a local provider that signs its own tokens: what is accepted and what is refused. */
describe('oidc client', () => {
    let mock: MockOidc;
    let oidc: OidcClient;
    const redirectUri = 'http://localhost:3000/auth/oidc/mock/callback';

    beforeAll(async () => {
        mock = await startMockOidc();

        const provider: OidcProvider = {
            id: 'mock',
            name: 'Mock',
            issuer: mock.issuer,
            clientId: mock.clientId,
            clientSecret: mock.clientSecret,
            scopes: ['openid', 'email', 'profile'],
            redirectUri,
        };

        oidc = createOidcClient(provider);
    });
    afterAll(() => mock.close());
    beforeEach(() => {
        mock.person = { sub: 'sub-1', email: 'person@example.test', email_verified: true };
        mock.next = {};
        mock.authorizeRequests.length = 0;
        mock.tokenRequests.length = 0;
        mock.setAuthMethods(['client_secret_basic', 'client_secret_post']);
    });

    /** Start, let the provider answer, and come back to the callback: returns the callback query and the flow the browser holds. */
    async function signIn(): Promise<{ query: URLSearchParams; flow: OidcFlowState }> {
        const { url, flow } = await oidc.startAuthorization();
        const back = new URL(await mock.authorize(url));

        return { query: back.searchParams, flow };
    }

    it('signs in and returns who the provider says the person is', async () => {
        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).resolves.toEqual({ subject: 'sub-1', email: 'person@example.test', emailVerified: true });
    });

    it('sends PKCE, state, nonce, scope and the redirect URI, and the provider checks the verifier', async () => {
        const { flow } = await signIn();
        const request = mock.authorizeRequests[0];

        expect(request?.get('code_challenge_method')).toBe('S256');
        expect(request?.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(request?.get('state')).toBe(flow.state);
        expect(request?.get('nonce')).toBe(flow.nonce);
        expect(request?.get('scope')).toBe('openid email profile');
        expect(request?.get('redirect_uri')).toBe(redirectUri);
        expect(request?.get('response_type')).toBe('code');
        // The challenge must not be the verifier itself.
        expect(request?.get('code_challenge')).not.toBe(flow.verifier);
    });

    it('sends the code verifier at the token endpoint, and the provider refuses a wrong one', async () => {
        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, { ...flow, verifier: 'x'.repeat(43) })).rejects.toThrow();
        expect(mock.tokenRequests[0]?.body.get('code_verifier')).toBe('x'.repeat(43));
    });

    it('refuses a callback whose state is not the one that was sent', async () => {
        const { query, flow } = await signIn();

        query.set('state', 'forged');

        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
        // It never even asked the provider to redeem the code.
        expect(mock.tokenRequests).toHaveLength(0);
    });

    it('refuses a callback with no state', async () => {
        const { query, flow } = await signIn();

        query.delete('state');

        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
    });

    it('refuses an ID token with another nonce', async () => {
        mock.next = { nonce: 'someone-elses-nonce' };

        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
    });

    it('refuses an ID token issued for another client', async () => {
        mock.next = { aud: 'another-client' };

        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
    });

    it('refuses an ID token from another issuer', async () => {
        mock.next = { iss: 'https://evil.example.com' };

        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
    });

    it('refuses an expired ID token', async () => {
        mock.next = { expiresIn: -3600 };

        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
    });

    it('refuses an ID token signed with a key that is not in the provider JWKS', async () => {
        mock.next = { signWithStrangerKey: true };

        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
    });

    it('refuses a code that was already redeemed', async () => {
        const { query, flow } = await signIn();

        await oidc.completeAuthorization(query, flow);
        await expect(oidc.completeAuthorization(query, flow)).rejects.toThrow();
    });

    it('refuses a provider error answer', async () => {
        const { flow } = await signIn();

        await expect(oidc.completeAuthorization(new URLSearchParams({ error: 'access_denied', state: flow.state }), flow)).rejects.toThrow();
    });

    it('does not count an email as verified unless the claim is the boolean true', async () => {
        mock.person = { sub: 'sub-2', email: 'x@example.test', email_verified: false };

        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).resolves.toMatchObject({ emailVerified: false });
    });

    it('asks the userinfo endpoint for the email facts when the ID token has none', async () => {
        mock.next = { emailInUserinfoOnly: true };

        const { query, flow } = await signIn();

        await expect(oidc.completeAuthorization(query, flow)).resolves.toEqual({ subject: 'sub-1', email: 'person@example.test', emailVerified: true });
    });

    it('authenticates with the client secret the way the provider asks', async () => {
        const basic = await signIn();

        await oidc.completeAuthorization(basic.query, basic.flow);
        expect(mock.tokenRequests[0]?.authorization).toMatch(/^Basic /);

        // A provider that only offers client_secret_post: its own client, since discovery is kept per client.
        mock.setAuthMethods(['client_secret_post']);

        const postOnly = createOidcClient({
            id: 'post',
            name: 'Post',
            issuer: mock.issuer,
            clientId: mock.clientId,
            clientSecret: mock.clientSecret,
            scopes: ['openid'],
            redirectUri,
        });
        const { url, flow } = await postOnly.startAuthorization();

        await postOnly.completeAuthorization(new URL(await mock.authorize(url)).searchParams, flow);
        expect(mock.tokenRequests[1]?.authorization).toBeUndefined();
        expect(mock.tokenRequests[1]?.body.get('client_secret')).toBe(mock.clientSecret);
    });

    it('does not talk to a plain-http provider that is not on this machine', async () => {
        const remote = createOidcClient({
            id: 'remote',
            name: 'Remote',
            issuer: 'http://auth.example.com',
            clientId: 'c',
            clientSecret: 's',
            scopes: ['openid'],
            redirectUri,
        });

        await expect(remote.startAuthorization()).rejects.toThrow();
    });
});

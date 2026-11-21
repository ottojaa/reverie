import { describe, expect, it } from 'vitest';
import { resolveOidcProviders } from './providers.js';

const authentik = { id: 'authentik', name: 'Authentik', issuer: 'https://auth.example.com/application/o/reverie/', clientId: 'cid', clientSecret: 'secret' };

describe('resolveOidcProviders', () => {
    it('has no providers when nothing is configured', () => {
        expect(resolveOidcProviders({})).toEqual([]);
    });

    it('maps the GOOGLE_* variables to a google provider that keeps the registered callback URL', () => {
        const [google, ...others] = resolveOidcProviders({
            GOOGLE_CLIENT_ID: 'gid',
            GOOGLE_CLIENT_SECRET: 'gsecret',
            GOOGLE_CALLBACK_URL: 'https://api.reverieapp.dev/auth/google/callback',
        });

        expect(others).toEqual([]);
        expect(google).toMatchObject({
            id: 'google',
            name: 'Google',
            issuer: 'https://accounts.google.com',
            clientId: 'gid',
            clientSecret: 'gsecret',
            redirectUri: 'https://api.reverieapp.dev/auth/google/callback',
        });
        expect(google?.scopes).toEqual(['openid', 'email', 'profile']);
    });

    it('treats an empty or blank OIDC_PROVIDERS (a bare `OIDC_PROVIDERS=` line in an env file) as no providers', () => {
        expect(resolveOidcProviders({ OIDC_PROVIDERS: '' })).toEqual([]);
        expect(resolveOidcProviders({ OIDC_PROVIDERS: '  ' })).toEqual([]);
    });

    it('needs all three GOOGLE_* variables', () => {
        expect(resolveOidcProviders({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' })).toEqual([]);
    });

    it('reads OIDC_PROVIDERS next to google, defaulting the redirect URI to the API address', () => {
        const providers = resolveOidcProviders({
            OIDC_PROVIDERS: JSON.stringify([authentik]),
            API_PUBLIC_URL: 'https://api.example.com/',
            GOOGLE_CLIENT_ID: 'gid',
            GOOGLE_CLIENT_SECRET: 'gsecret',
            GOOGLE_CALLBACK_URL: 'https://api.example.com/auth/google/callback',
        });

        expect(providers.map((provider) => provider.id)).toEqual(['authentik', 'google']);
        expect(providers[0]?.redirectUri).toBe('https://api.example.com/auth/oidc/authentik/callback');
    });

    it('lets OIDC_PROVIDERS define google itself', () => {
        const providers = resolveOidcProviders({
            OIDC_PROVIDERS: JSON.stringify([{ ...authentik, id: 'google', name: 'Google (custom)' }]),
            GOOGLE_CLIENT_ID: 'gid',
            GOOGLE_CLIENT_SECRET: 'gsecret',
            GOOGLE_CALLBACK_URL: 'https://api.example.com/auth/google/callback',
        });

        expect(providers).toHaveLength(1);
        expect(providers[0]?.name).toBe('Google (custom)');
    });

    it('always asks for the openid scope', () => {
        const [provider] = resolveOidcProviders({ OIDC_PROVIDERS: JSON.stringify([{ ...authentik, scopes: ['email'] }]) });

        expect(provider?.scopes).toEqual(['openid', 'email']);
    });

    it('refuses bad configuration instead of starting half-configured', () => {
        expect(() => resolveOidcProviders({ OIDC_PROVIDERS: '{nope' })).toThrow('not valid JSON');
        expect(() => resolveOidcProviders({ OIDC_PROVIDERS: JSON.stringify([{ ...authentik, id: 'Bad Id' }]) })).toThrow('invalid');
        expect(() => resolveOidcProviders({ OIDC_PROVIDERS: JSON.stringify([authentik, authentik]) })).toThrow('twice');
        expect(() => resolveOidcProviders({ OIDC_PROVIDERS: JSON.stringify([{ ...authentik, redirectUri: 'https://x.example.com/elsewhere' }]) })).toThrow(
            'redirectUri',
        );
    });
});

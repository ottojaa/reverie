import * as client from 'openid-client';
import { z } from 'zod';
import type { OidcProvider } from './providers.js';

/** What the browser's own cookie carries from the redirect to the provider until it comes back. */
export interface OidcFlowState {
    state: string;
    nonce: string;
    verifier: string;
}

/** The facts about the person a provider vouches for. `emailVerified` is true only for a boolean `true` claim. */
export interface OidcIdentity {
    subject: string;
    email: string | null;
    emailVerified: boolean;
}

export interface OidcClient {
    startAuthorization: () => Promise<{ url: string; flow: OidcFlowState }>;
    completeAuthorization: (query: URLSearchParams, flow: OidcFlowState) => Promise<OidcIdentity>;
}

const FETCH_TIMEOUT_SECONDS = 10;

/** The claims read from the ID token (and userinfo): a verified email is only ever a boolean `true`. */
const IdentityClaimsSchema = z.object({
    sub: z.string().min(1),
    email: z.string().optional(),
    email_verified: z.boolean().optional(),
});

function isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

async function discoverConfiguration(provider: OidcProvider): Promise<client.Configuration> {
    const issuer = new URL(provider.issuer);
    // Plain http is for a provider on this machine (the mock in tests, a dev Keycloak); anything else must be https.
    const options: client.DiscoveryRequestOptions = { timeout: FETCH_TIMEOUT_SECONDS };

    if (issuer.protocol === 'http:' && isLoopbackHost(issuer.hostname)) options.execute = [client.allowInsecureRequests];

    const discovered = await client.discovery(issuer, provider.clientId, provider.clientSecret, client.ClientSecretBasic(provider.clientSecret), options);
    const methods = discovered.serverMetadata().token_endpoint_auth_methods_supported;
    const postOnly = methods !== undefined && !methods.includes('client_secret_basic') && methods.includes('client_secret_post');
    const config = postOnly
        ? new client.Configuration(discovered.serverMetadata(), provider.clientId, provider.clientSecret, client.ClientSecretPost(provider.clientSecret))
        : discovered;

    if (postOnly) {
        config.timeout = FETCH_TIMEOUT_SECONDS;
        options.execute?.forEach((extension) => extension(config));
    }

    // Without this the library trusts the ID token because it came over TLS; this makes it check the signature against the provider's JWKS too (RS256, which every provider must offer).
    client.enableNonRepudiationChecks(config);

    return config;
}

/** One provider's OpenID Connect client. Discovery runs on first use and is kept; a failed discovery is retried on the next sign-in. */
export function createOidcClient(provider: OidcProvider): OidcClient {
    let discovery: Promise<client.Configuration> | null = null;

    function loadConfig() {
        discovery ??= discoverConfiguration(provider).catch((error: unknown) => {
            discovery = null;
            throw error;
        });

        return discovery;
    }

    async function startAuthorization() {
        const config = await loadConfig();
        const flow: OidcFlowState = { state: client.randomState(), nonce: client.randomNonce(), verifier: client.randomPKCECodeVerifier() };
        const url = client.buildAuthorizationUrl(config, {
            redirect_uri: provider.redirectUri,
            scope: provider.scopes.join(' '),
            state: flow.state,
            nonce: flow.nonce,
            code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
            code_challenge_method: 'S256',
        });

        return { url: url.href, flow };
    }

    async function completeAuthorization(query: URLSearchParams, flow: OidcFlowState) {
        const config = await loadConfig();
        // The library reads the redirect URI and the response parameters from this URL, so it is the registered address, not whatever host a proxy showed us.
        const callbackUrl = new URL(provider.redirectUri);

        callbackUrl.search = query.toString();

        // Checks state, issuer, audience, authorized party, expiry, nonce, the PKCE verifier and the ID token's signature; any failure throws.
        const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
            pkceCodeVerifier: flow.verifier,
            expectedState: flow.state,
            expectedNonce: flow.nonce,
            idTokenExpected: true,
        });
        const claims = IdentityClaimsSchema.parse(tokens.claims());
        const hasEmailFacts = claims.email !== undefined && claims.email_verified !== undefined;

        if (hasEmailFacts || !config.serverMetadata().userinfo_endpoint) {
            return { subject: claims.sub, email: claims.email ?? null, emailVerified: claims.email_verified === true };
        }

        // Some providers (Authelia) keep the email facts out of the ID token; the userinfo endpoint is asked for them, and must answer for the same subject.
        const userinfo = IdentityClaimsSchema.partial().parse(await client.fetchUserInfo(config, tokens.access_token, claims.sub));

        return {
            subject: claims.sub,
            email: claims.email ?? userinfo.email ?? null,
            emailVerified: (claims.email_verified ?? userinfo.email_verified) === true,
        };
    }

    return { startAuthorization, completeAuthorization };
}

import { z } from 'zod';

/**
 * The OpenID Connect providers a deployment signs in with. Configured by `OIDC_PROVIDERS`, a JSON array:
 *
 *   [{ "id": "authentik", "name": "Authentik", "issuer": "https://auth.example.com/application/o/reverie/",
 *      "clientId": "...", "clientSecret": "...", "scopes": ["openid", "email", "profile"], "redirectUri": "https://api.example.com/auth/oidc/authentik/callback" }]
 *
 * `scopes` and `redirectUri` are optional. The old GOOGLE_* variables add a `google` provider on their own.
 */

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_SCOPES = ['openid', 'email', 'profile'];
export const GOOGLE_ISSUER = 'https://accounts.google.com';

const ProviderConfigSchema = z.object({
    id: z.string().regex(PROVIDER_ID, 'id: lowercase letters, digits and dashes'),
    name: z.string().min(1),
    issuer: z.string().url(),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    scopes: z.array(z.string().min(1)).optional(),
    redirectUri: z.string().url().optional(),
});

export interface OidcProvider {
    id: string;
    name: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    /** Always contains `openid`. */
    scopes: string[];
    /** The URL registered at the provider; the callback route answers on its path. */
    redirectUri: string;
}

export interface OidcEnv {
    OIDC_PROVIDERS?: string | undefined;
    GOOGLE_CLIENT_ID?: string | undefined;
    GOOGLE_CLIENT_SECRET?: string | undefined;
    GOOGLE_CALLBACK_URL?: string | undefined;
    API_PUBLIC_URL?: string | undefined;
    PORT?: number | undefined;
}

function parseProviderJson(raw: string | undefined): z.infer<typeof ProviderConfigSchema>[] {
    if (!raw?.trim()) return [];

    let json: unknown;

    try {
        json = JSON.parse(raw);
    } catch {
        throw new Error('OIDC_PROVIDERS is not valid JSON');
    }

    const parsed = z.array(ProviderConfigSchema).safeParse(json);

    if (!parsed.success)
        throw new Error('OIDC_PROVIDERS is invalid: ' + parsed.error.issues.map((issue) => issue.path.join('.') + ' ' + issue.message).join('; '));

    return parsed.data;
}

/** The routes that answer a provider's redirect; a registered redirect URI must end in one of them. */
function callbackPaths(id: string): string[] {
    return [`/auth/oidc/${id}/callback`, ...(id === 'google' ? ['/auth/google/callback'] : [])];
}

function toProvider(config: z.infer<typeof ProviderConfigSchema>, apiBase: string): OidcProvider {
    const scopes = config.scopes ?? DEFAULT_SCOPES;
    const redirectUri = config.redirectUri ?? `${apiBase}/auth/oidc/${config.id}/callback`;

    if (!callbackPaths(config.id).some((path) => new URL(redirectUri).pathname.endsWith(path))) {
        throw new Error('OIDC redirectUri must end in ' + callbackPaths(config.id).join(' or ') + ': ' + config.id);
    }

    return {
        id: config.id,
        name: config.name,
        issuer: config.issuer,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scopes: scopes.includes('openid') ? scopes : ['openid', ...scopes],
        redirectUri,
    };
}

/** The configured providers, in order: those from OIDC_PROVIDERS, then `google` from GOOGLE_* unless OIDC_PROVIDERS already defines it. Throws on bad config. */
export function resolveOidcProviders(env: OidcEnv): OidcProvider[] {
    const apiBase = (env.API_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, '');
    const configs = parseProviderJson(env.OIDC_PROVIDERS);

    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL && !configs.some((config) => config.id === 'google')) {
        configs.push({
            id: 'google',
            name: 'Google',
            issuer: GOOGLE_ISSUER,
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_CALLBACK_URL,
        });
    }

    const ids = configs.map((config) => config.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);

    if (duplicate) throw new Error('OIDC_PROVIDERS has a provider id twice: ' + duplicate);

    return configs.map((config) => toProvider(config, apiBase));
}

import { OidcProvidersResponseSchema } from '@reverie/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { findUserForIdentity } from '../../oidc/identities.js';
import { issueOauthCode } from '../../oidc/oauth-code-store.js';
import { createOidcClient, type OidcFlowState } from '../../oidc/oidc-client.js';
import { resolveOidcProviders } from '../../oidc/providers.js';
import { createAuthService, type AuthService } from '../../services/auth.service.js';
import { toAddressKey } from '../plugins/rate-limit.js';

/** Holds the PKCE verifier, state and nonce in the browser that started the sign-in; signed, so the callback trusts only what this server wrote. */
const FLOW_COOKIE = 'oidc_flow';
const FLOW_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const FLOW_COOKIE_PATH = '/auth';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const FlowCookieSchema = z.object({ provider: z.string(), state: z.string(), nonce: z.string(), verifier: z.string() });

const ProviderParamsSchema = z.object({ provider: z.string() });
const rateLimit = { rateLimit: { max: 60, timeWindow: '15 minutes', keyGenerator: toAddressKey } };

export default async function (fastify: FastifyInstance) {
    const providers = resolveOidcProviders(env);
    const clients = new Map(providers.map((provider) => [provider.id, createOidcClient(provider)]));
    let authService: AuthService;

    fastify.addHook('onReady', async () => {
        authService = createAuthService(fastify);
    });

    function sendToLogin(reply: FastifyReply, error: 'oidc_auth_failed' | 'oidc_account_not_linked') {
        return reply.redirect(`${env.CORS_ORIGIN}/login?error=${error}`);
    }

    function readFlow(request: FastifyRequest, providerId: string): OidcFlowState | null {
        const raw = request.cookies[FLOW_COOKIE];
        const unsigned = raw ? request.unsignCookie(raw) : null;

        if (!unsigned?.valid || !unsigned.value) return null;

        try {
            const flow = FlowCookieSchema.parse(JSON.parse(unsigned.value));

            return flow.provider === providerId ? flow : null;
        } catch {
            return null;
        }
    }

    async function startSignIn(request: FastifyRequest, reply: FastifyReply, providerId: string) {
        const oidc = clients.get(providerId);

        if (!oidc) return reply.status(404).send({ error: 'unknown_provider', message: 'No such sign-in provider' });

        try {
            const { url, flow } = await oidc.startAuthorization();

            reply.setCookie(FLOW_COOKIE, JSON.stringify({ provider: providerId, ...flow }), {
                signed: true,
                httpOnly: true,
                secure: env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: FLOW_COOKIE_PATH,
                maxAge: FLOW_COOKIE_MAX_AGE_SECONDS,
            });

            return reply.redirect(url);
        } catch (err) {
            request.log.error({ err, provider: providerId }, 'Failed to start OIDC sign-in');

            return sendToLogin(reply, 'oidc_auth_failed');
        }
    }

    async function finishSignIn(request: FastifyRequest, reply: FastifyReply, providerId: string) {
        const oidc = clients.get(providerId);

        if (!oidc) return reply.status(404).send({ error: 'unknown_provider', message: 'No such sign-in provider' });

        const flow = readFlow(request, providerId);

        reply.clearCookie(FLOW_COOKIE, { path: FLOW_COOKIE_PATH });

        if (!flow) return sendToLogin(reply, 'oidc_auth_failed');

        try {
            const identity = await oidc.completeAuthorization(new URL(request.url, 'http://localhost').searchParams, flow);
            const user = await findUserForIdentity(providerId, identity);

            if (!user) return sendToLogin(reply, 'oidc_account_not_linked');

            const { tokens } = await authService.startSession(user);

            reply.setCookie('refresh_token', tokens.refresh_token, {
                httpOnly: true,
                secure: env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/auth',
                maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
            });

            // A short-lived code instead of the token in the URL (logs, history).
            return reply.redirect(`${env.CORS_ORIGIN}/login/callback?code=${issueOauthCode(tokens.access_token, tokens.expires_in)}`);
        } catch (err) {
            request.log.warn({ err, provider: providerId }, 'OIDC sign-in failed');

            return sendToLogin(reply, 'oidc_auth_failed');
        }
    }

    // GET /auth/oidc/providers - What the login page offers (public)
    fastify.get(
        '/auth/oidc/providers',
        {
            schema: {
                description: 'External sign-in providers configured on this server',
                tags: ['Auth'],
                response: { 200: OidcProvidersResponseSchema },
            },
        },
        async function () {
            return { providers: providers.map(({ id, name }) => ({ id, name })) };
        },
    );

    // GET /auth/oidc/:provider - Start sign-in (redirects to the provider)
    fastify.get<{ Params: { provider: string } }>(
        '/auth/oidc/:provider',
        {
            config: rateLimit,
            schema: { description: 'Start OpenID Connect sign-in (redirects to the provider)', tags: ['Auth'], params: ProviderParamsSchema },
        },
        async function (request, reply) {
            return startSignIn(request, reply, request.params.provider);
        },
    );

    // GET /auth/oidc/:provider/callback - Where the provider sends the browser back
    fastify.get<{ Params: { provider: string } }>(
        '/auth/oidc/:provider/callback',
        {
            config: rateLimit,
            schema: { description: 'OpenID Connect callback', tags: ['Auth'], params: ProviderParamsSchema },
        },
        async function (request, reply) {
            return finishSignIn(request, reply, request.params.provider);
        },
    );

    // Google was the only provider before OpenID Connect: its sign-in start and its registered callback URL keep working.
    fastify.get(
        '/auth/google',
        { config: rateLimit, schema: { description: 'Start Google sign-in (redirects to /auth/oidc/google)', tags: ['Auth'] } },
        async function (_request, reply) {
            return reply.redirect('/auth/oidc/google');
        },
    );

    fastify.get(
        '/auth/google/callback',
        { config: rateLimit, schema: { description: 'Google sign-in callback', tags: ['Auth'] } },
        async function (request, reply) {
            return finishSignIn(request, reply, 'google');
        },
    );
}

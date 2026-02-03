import {
    AuthErrorSchema,
    ChangePasswordRequestSchema,
    CurrentUserResponseSchema,
    LoginRequestSchema,
    LoginResponseSchema,
    RefreshTokenRequestSchema,
    RefreshTokenResponseSchema,
} from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { User } from '../../db/schema.js';
import { createAuthService, type AuthService } from '../../services/auth.service.js';

// Simple success response schema
const SuccessResponseSchema = z.object({ success: z.boolean() });

// Google userinfo response type
interface GoogleUserInfo {
    id: string;
    email: string;
    verified_email: boolean;
    name: string;
    picture?: string;
}

// Serialize user for API response (exclude sensitive fields)
function serializeUser(user: User) {
    return {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        storage_quota_bytes: Number(user.storage_quota_bytes),
        storage_used_bytes: Number(user.storage_used_bytes),
        is_active: user.is_active,
        created_at: user.created_at.toISOString(),
        last_login_at: user.last_login_at?.toISOString() ?? null,
    };
}

export default async function (fastify: FastifyInstance) {
    let authService: AuthService;

    // Initialize auth service after plugins are loaded
    fastify.addHook('onReady', async () => {
        authService = createAuthService(fastify);
    });

    // POST /auth/login - Email/password login
    fastify.post<{ Body: { email: string; password: string } }>(
        '/auth/login',
        {
            schema: {
                description: 'Login with email and password',
                tags: ['Auth'],
                body: LoginRequestSchema,
                response: {
                    200: LoginResponseSchema,
                    401: AuthErrorSchema,
                },
            },
        },
        async function (request, reply) {
            const { email, password } = request.body;

            const result = await authService.authenticateWithPassword(email, password);

            if (!result) {
                return reply.status(401).send({
                    error: 'invalid_credentials',
                    message: 'Invalid email or password',
                });
            }

            // Set refresh token as httpOnly cookie
            reply.setCookie('refresh_token', result.tokens.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/auth',
                maxAge: 7 * 24 * 60 * 60, // 7 days
            });

            return {
                user: serializeUser(result.user),
                access_token: result.tokens.access_token,
                refresh_token: result.tokens.refresh_token,
                expires_in: result.tokens.expires_in,
            };
        },
    );

    // POST /auth/refresh - Refresh access token
    fastify.post<{ Body: { refresh_token?: string } }>(
        '/auth/refresh',
        {
            schema: {
                description: 'Refresh access token using refresh token',
                tags: ['Auth'],
                body: RefreshTokenRequestSchema.partial(),
                response: {
                    200: RefreshTokenResponseSchema,
                    401: AuthErrorSchema,
                },
            },
        },
        async function (request, reply) {
            // Try to get refresh token from body or cookie
            const refreshToken = request.body.refresh_token || request.cookies.refresh_token;

            if (!refreshToken) {
                return reply.status(401).send({
                    error: 'token_invalid',
                    message: 'No refresh token provided',
                });
            }

            // Verify the refresh token
            const payload = await authService.verifyRefreshToken(refreshToken);

            if (!payload) {
                return reply.status(401).send({
                    error: 'token_expired',
                    message: 'Refresh token is invalid or expired',
                });
            }

            // Get user to ensure they still exist and are active
            const user = await authService.findUserById(payload.sub);

            if (!user || !user.is_active) {
                return reply.status(401).send({
                    error: 'account_disabled',
                    message: 'Account not found or disabled',
                });
            }

            // Generate new access token
            const tokens = authService.generateTokens(user);

            return {
                access_token: tokens.access_token,
                expires_in: tokens.expires_in,
            };
        },
    );

    // POST /auth/logout - Clear refresh token cookie
    fastify.post(
        '/auth/logout',
        {
            schema: {
                description: 'Logout and clear refresh token',
                tags: ['Auth'],
                response: {
                    200: SuccessResponseSchema,
                },
            },
        },
        async function (request, reply) {
            reply.clearCookie('refresh_token', { path: '/auth' });
            return { success: true };
        },
    );

    // GET /auth/me - Get current user info (requires authentication)
    fastify.get(
        '/auth/me',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get current authenticated user info',
                tags: ['Auth'],
                response: {
                    200: CurrentUserResponseSchema,
                    401: AuthErrorSchema,
                },
            },
        },
        async function (request) {
            const user = await authService.findUserById(request.user.id);

            if (!user) {
                throw fastify.httpErrors.unauthorized('User not found');
            }

            return {
                user: serializeUser(user),
            };
        },
    );

    // POST /auth/change-password - Change password (requires authentication)
    fastify.post<{ Body: { current_password: string; new_password: string } }>(
        '/auth/change-password',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Change password for authenticated user',
                tags: ['Auth'],
                body: ChangePasswordRequestSchema,
                response: {
                    200: SuccessResponseSchema,
                    400: AuthErrorSchema,
                },
            },
        },
        async function (request, reply) {
            const { current_password, new_password } = request.body;

            const success = await authService.changePassword(request.user.id, current_password, new_password);

            if (!success) {
                return reply.status(400).send({
                    error: 'password_mismatch',
                    message: 'Current password is incorrect',
                });
            }

            return { success: true };
        },
    );

    // GET /auth/google - Start Google OAuth (redirect to Google)
    // Explicit route because the oauth2 plugin registers inside its encapsulated context and isn't visible here
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL) {
        fastify.get(
            '/auth/google',
            {
                schema: {
                    description: 'Start Google OAuth flow (redirects to Google)',
                    tags: ['Auth'],
                },
            },
            async function (request, reply) {
                const oauth2 = (fastify as unknown as { googleOAuth2?: { generateAuthorizationUri: (req: unknown, reply: unknown) => Promise<string> } }).googleOAuth2;
                if (!oauth2) {
                    return reply.status(500).send({
                        error: 'google_oauth_not_configured',
                        message: 'Google OAuth not configured',
                    });
                }
                const authorizationUri = await oauth2.generateAuthorizationUri(request, reply);
                return reply.redirect(authorizationUri);
            },
        );

        // GET /auth/google/callback - Google OAuth callback
        fastify.get<{ Querystring: { code?: string; error?: string } }>(
            '/auth/google/callback',
            {
                schema: {
                    description: 'Google OAuth callback',
                    tags: ['Auth'],
                },
            },
            async function (request, reply) {
                try {
                    // Get the OAuth2 plugin instance
                    const oauth2 = (fastify as any).googleOAuth2;

                    if (!oauth2) {
                        return reply.status(500).send({
                            error: 'google_account_not_linked',
                            message: 'Google OAuth not configured',
                        });
                    }

                    // Exchange code for token
                    const tokenResponse = await oauth2.getAccessTokenFromAuthorizationCodeFlow(request);

                    // Get user info from Google
                    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                        headers: {
                            Authorization: `Bearer ${tokenResponse.token.access_token}`,
                        },
                    });

                    if (!userInfoResponse.ok) {
                        return reply.status(401).send({
                            error: 'invalid_credentials',
                            message: 'Failed to get user info from Google',
                        });
                    }

                    const googleUser = (await userInfoResponse.json()) as GoogleUserInfo;

                    // Try to find user by Google ID
                    const result = await authService.authenticateWithGoogle(googleUser.id);

                    if (!result) {
                        // User not found - redirect to error page
                        // In production, redirect to frontend with error
                        const errorUrl = `${env.CORS_ORIGIN}/login?error=google_account_not_linked`;
                        return reply.redirect(errorUrl);
                    }

                    // Set refresh token as httpOnly cookie
                    reply.setCookie('refresh_token', result.tokens.refresh_token, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'lax',
                        path: '/auth',
                        maxAge: 7 * 24 * 60 * 60, // 7 days
                    });

                    // Redirect to frontend with access token
                    const successUrl = `${env.CORS_ORIGIN}/login/callback?access_token=${result.tokens.access_token}&expires_in=${result.tokens.expires_in}`;
                    return reply.redirect(successUrl);
                } catch (err) {
                    console.error('Google OAuth error:', err);
                    const errorUrl = `${env.CORS_ORIGIN}/login?error=google_auth_failed`;
                    return reply.redirect(errorUrl);
                }
            },
        );
    }
}

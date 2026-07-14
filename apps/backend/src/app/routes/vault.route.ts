import {
    VaultSettingsRequestSchema,
    VaultStatusSchema,
    VaultUnlockRequestSchema,
    type VaultSettingsRequest,
    type VaultStatus,
    type VaultUnlockRequest,
} from '@reverie/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db } from '../../db/kysely.js';
import { createAuthService, type AuthService } from '../../services/auth.service.js';
import { readVaultSession, signVaultToken, VAULT_COOKIE, VAULT_TTL_SECONDS } from '../../services/vault.js';

const VaultErrorSchema = z.object({ error: z.string(), message: z.string() });

export default async function (fastify: FastifyInstance) {
    let authService: AuthService;

    fastify.addHook('onReady', async () => {
        authService = createAuthService(fastify);
    });

    // Build the current vault status from the DB + request cookie.
    async function buildStatus(request: FastifyRequest, userId: string): Promise<VaultStatus> {
        const user = await db.selectFrom('users').select(['hide_private', 'password_hash']).where('id', '=', userId).executeTakeFirst();
        const session = readVaultSession(fastify, request, userId);

        return {
            hide_enabled: !!user?.hide_private,
            unlocked: session.unlocked,
            expires_at: session.expiresAt,
            has_password: !!user?.password_hash,
        };
    }

    // GET /vault/status - current lock state (requires authentication)
    fastify.get(
        '/vault/status',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get the current vault (private-items) lock state',
                tags: ['Vault'],
                response: { 200: VaultStatusSchema },
            },
        },
        async function (request) {
            return buildStatus(request, request.user.id);
        },
    );

    // POST /vault/unlock - reveal private items by re-entering the account password
    fastify.post<{ Body: VaultUnlockRequest }>(
        '/vault/unlock',
        {
            config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Unlock the vault (reveal private items) with the account password',
                tags: ['Vault'],
                body: VaultUnlockRequestSchema,
                response: { 200: VaultStatusSchema, 400: VaultErrorSchema, 401: VaultErrorSchema },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const user = await authService.findUserById(userId);

            if (!user) {
                return reply.status(401).send({ error: 'unauthorized', message: 'User not found' });
            }

            if (!user.password_hash) {
                return reply.status(400).send({ error: 'no_password', message: 'Set an account password to unlock private items' });
            }

            const ok = await authService.verifyPassword(request.body.password, user.password_hash);

            if (!ok) {
                return reply.status(401).send({ error: 'invalid_credentials', message: 'Incorrect password' });
            }

            reply.setCookie(VAULT_COOKIE, signVaultToken(fastify, userId), {
                httpOnly: true,
                secure: env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: VAULT_TTL_SECONDS,
            });

            // Cookie is on the reply, not yet on the request, so report the fresh session directly.
            return {
                hide_enabled: !!user.hide_private,
                unlocked: true,
                expires_at: new Date(Date.now() + VAULT_TTL_SECONDS * 1000).toISOString(),
                has_password: true,
            };
        },
    );

    // POST /vault/lock - re-hide private items immediately
    fastify.post(
        '/vault/lock',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Lock the vault (re-hide private items)',
                tags: ['Vault'],
                response: { 200: VaultStatusSchema },
            },
        },
        async function (request, reply) {
            reply.clearCookie(VAULT_COOKIE, { path: '/' });

            const user = await db.selectFrom('users').select(['hide_private', 'password_hash']).where('id', '=', request.user.id).executeTakeFirst();

            return {
                hide_enabled: !!user?.hide_private,
                unlocked: false,
                expires_at: null,
                has_password: !!user?.password_hash,
            };
        },
    );

    // PATCH /vault/settings - toggle "hide private items". Turning it OFF requires an unlocked session.
    fastify.patch<{ Body: VaultSettingsRequest }>(
        '/vault/settings',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Enable or disable hiding private items from the sidebar',
                tags: ['Vault'],
                body: VaultSettingsRequestSchema,
                response: { 200: VaultStatusSchema, 400: VaultErrorSchema, 401: VaultErrorSchema, 403: VaultErrorSchema },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { hide_private } = request.body;
            const user = await authService.findUserById(userId);

            if (!user) {
                return reply.status(401).send({ error: 'unauthorized', message: 'User not found' });
            }

            if (hide_private) {
                // Enabling hiding is only meaningful if there is a password to unlock with later.
                if (!user.password_hash) {
                    return reply.status(400).send({ error: 'no_password', message: 'Set an account password before hiding private items' });
                }
            } else if (user.hide_private) {
                // Disabling hiding would permanently expose private items — require an unlocked session.
                const session = readVaultSession(fastify, request, userId);

                if (!session.unlocked) {
                    return reply.status(403).send({ error: 'locked', message: 'Unlock to change this setting' });
                }
            }

            await db.updateTable('users').set({ hide_private }).where('id', '=', userId).execute();

            return buildStatus(request, userId);
        },
    );
}

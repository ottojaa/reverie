import { VaultStatusSchema, VaultUnlockRequestSchema, type VaultStatus, type VaultUnlockRequest } from '@reverie/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db } from '../../db/kysely.js';
import { createAuthService, type AuthService } from '../../services/auth.service.js';
import { isVaultUnlocked, signVaultToken, VAULT_COOKIE } from '../../services/vault.js';

const VaultErrorSchema = z.object({ error: z.string(), message: z.string() });

export default async function (fastify: FastifyInstance) {
    let authService: AuthService;

    fastify.addHook('onReady', async () => {
        authService = createAuthService(fastify);
    });

    // Build the current vault status from the DB + request cookie.
    async function buildStatus(request: FastifyRequest, userId: string): Promise<VaultStatus> {
        const user = await db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirst();

        return {
            unlocked: isVaultUnlocked(fastify, request, userId),
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

    // POST /vault/unlock - unlock private items by re-entering the account password
    fastify.post<{ Body: VaultUnlockRequest }>(
        '/vault/unlock',
        {
            config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Unlock the vault (open private items) with the account password',
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

            // Session cookie (no maxAge/expires): the unlock lasts until the browser/app
            // session ends, logout, or an explicit lock — no idle timeout. maxAge on the
            // JWT is just a long backstop so the token itself never expires mid-session.
            reply.setCookie(VAULT_COOKIE, signVaultToken(fastify, userId), {
                httpOnly: true,
                secure: env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
            });

            // Cookie is on the reply, not yet on the request, so report the fresh session directly.
            return { unlocked: true, has_password: true };
        },
    );

    // POST /vault/lock - re-lock private items immediately
    fastify.post(
        '/vault/lock',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Lock the vault (re-hide private item content)',
                tags: ['Vault'],
                response: { 200: VaultStatusSchema },
            },
        },
        async function (request, reply) {
            reply.clearCookie(VAULT_COOKIE, { path: '/' });

            const user = await db.selectFrom('users').select('password_hash').where('id', '=', request.user.id).executeTakeFirst();

            return { unlocked: false, has_password: !!user?.password_hash };
        },
    );
}

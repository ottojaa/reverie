import { NotFoundError, VaultStatusSchema, VaultUnlockRequestSchema, type VaultStatus, type VaultUnlockRequest } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAuthService, type AuthService } from '../../services/auth.service.js';
import { clearVaultCookie, fetchHasPassword, loadFolderLocks, setVaultCookie } from '../../services/folder-locks.js';
import { loadLockMap } from '../../services/privacy.js';

const VaultErrorSchema = z.object({ error: z.string(), message: z.string() });

export default async function (fastify: FastifyInstance) {
    let authService: AuthService;

    fastify.addHook('onReady', async () => {
        authService = createAuthService(fastify);
    });

    // GET /vault/status - whether any folder lock is open in this session (requires authentication)
    fastify.get(
        '/vault/status',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Get the folder-lock state of this session',
                tags: ['Vault'],
                response: { 200: VaultStatusSchema },
            },
        },
        async function (request): Promise<VaultStatus> {
            const userId = request.user.id;
            const locks = await loadFolderLocks(fastify, request, userId);

            return { unlocked: locks.openLockIds.length > 0, has_password: await fetchHasPassword(userId) };
        },
    );

    // POST /vault/unlock - open one folder's lock by re-entering the account password
    fastify.post<{ Body: VaultUnlockRequest }>(
        '/vault/unlock',
        {
            config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Unlock one private folder (or collection) with the account password. Other folders stay locked.',
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
                return reply.status(400).send({ error: 'no_password', message: 'Set an account password to unlock private folders' });
            }

            if (!(await authService.verifyPassword(request.body.password, user.password_hash))) {
                return reply.status(401).send({ error: 'invalid_credentials', message: 'Incorrect password' });
            }

            // Trash is ignored by the lock map, so a trashed private folder can be unlocked to browse and restore it.
            const lockId = (await loadLockMap(userId)).get(request.body.folder_id);

            if (!lockId) throw new NotFoundError('Private folder', request.body.folder_id);

            const locks = await loadFolderLocks(fastify, request, userId);

            // Session cookie (no maxAge/expires): the unlock lasts until the browser/app session ends or
            // logout. Re-signed with the old open locks plus this one.
            setVaultCookie(fastify, reply, userId, Array.from(new Set([...locks.openLockIds, lockId])));

            return { unlocked: true, has_password: true };
        },
    );

    // POST /vault/lock - close every open lock at once (the app has no per-folder lock action; kept for older Android builds)
    fastify.post(
        '/vault/lock',
        {
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Close every folder lock opened in this session',
                tags: ['Vault'],
                response: { 200: VaultStatusSchema },
            },
        },
        async function (request, reply): Promise<VaultStatus> {
            clearVaultCookie(reply);

            return { unlocked: false, has_password: await fetchHasPassword(request.user.id) };
        },
    );
}

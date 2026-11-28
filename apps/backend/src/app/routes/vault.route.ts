import {
    AppError,
    NotFoundError,
    VaultRefusalSchema,
    VaultSecretRequestSchema,
    VaultStatusSchema,
    VaultUnlockRequestSchema,
    type VaultSecretRequest,
    type VaultStatus,
    type VaultUnlockRequest,
} from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clearVaultCookie, loadFolderLocksAndSecret, setVaultCookie } from '../../services/folder-locks.js';
import { fetchLockSecretState, replaceLockSecret, verifyUnlock, type LockSecretState } from '../../services/lock-secret.js';
import { loadLockMap } from '../../services/privacy.js';
import { toAddressKey } from '../plugins/rate-limit.js';

const VaultErrorSchema = z.object({ error: z.string(), message: z.string() });

function toVaultStatus(state: LockSecretState, unlocked: boolean): VaultStatus {
    return { unlocked, has_password: state.enforced, secret_kind: state.secretKind, ask: state.ask };
}

/** Folder locks are opened and changed only by a user who has an account password. */
function assertCanLock(state: LockSecretState): void {
    if (!state.exists) throw new AppError(401, 'unauthorized', 'User not found');

    if (!state.enforced) throw new AppError(400, 'no_password', 'Set an account password to unlock private folders');
}

export default async function (fastify: FastifyInstance) {
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
            const { locks, secret } = await loadFolderLocksAndSecret(fastify, request, request.user.id);

            return toVaultStatus(secret, locks.openLockIds.length > 0);
        },
    );

    // POST /vault/unlock - open one folder's lock with the lock secret, or the account password when `ask` says so
    fastify.post<{ Body: VaultUnlockRequest }>(
        '/vault/unlock',
        {
            config: { rateLimit: { max: 30, timeWindow: '15 minutes', keyGenerator: toAddressKey } },
            preHandler: [fastify.authenticate],
            schema: {
                description: 'Unlock one private folder, and what is beneath it, with what the vault status asks for. Other folders stay locked.',
                tags: ['Vault'],
                body: VaultUnlockRequestSchema,
                // The 401 schema keeps that answer to `error` and `message`, as installed apps know it.
                response: { 200: VaultStatusSchema, 400: VaultErrorSchema, 401: VaultErrorSchema, 403: VaultRefusalSchema },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { password, folder_id } = request.body;
            // Trash is ignored by the lock map, so a trashed private folder can be unlocked to browse and restore it.
            const [before, lockMap] = await Promise.all([fetchLockSecretState(userId), loadLockMap(userId)]);
            assertCanLock(before);
            const lockId = lockMap.get(folder_id);

            // With a lock secret set the folder is looked at first, so no try is spent on one that has no lock. Without
            // one the password comes first: installed apps close their prompt on a 404, a wrong password or not.
            if (!lockId && before.secretKind) throw new NotFoundError('Private folder', folder_id);

            const { generation } = await verifyUnlock(userId, password);

            if (!lockId) throw new NotFoundError('Private folder', folder_id);

            // Read after the check: it may have given tries back, and a save may have come in meanwhile.
            const { locks, secret } = await loadFolderLocksAndSecret(fastify, request, userId, lockMap);

            // Session cookie (no maxAge/expires): the unlock lasts until the browser/app session ends or
            // logout. Re-signed with the old open locks plus this one.
            setVaultCookie(fastify, reply, userId, Array.from(new Set([...locks.openLockIds, lockId])), generation);

            return toVaultStatus(secret, true);
        },
    );

    // PUT /vault/secret - set, change or remove the lock secret, proven with the account password
    fastify.put<{ Body: VaultSecretRequest }>(
        '/vault/secret',
        {
            config: { rateLimit: { max: 30, timeWindow: '15 minutes', keyGenerator: toAddressKey } },
            preHandler: [fastify.authenticate],
            schema: {
                description: "Set, change or remove the PIN or password that opens private folders. Closes every other session's open locks.",
                tags: ['Vault'],
                body: VaultSecretRequestSchema,
                response: { 200: VaultStatusSchema, 400: VaultErrorSchema, 401: VaultErrorSchema, 403: VaultRefusalSchema },
            },
        },
        async function (request, reply) {
            const userId = request.user.id;
            const { account_password, secret } = request.body;
            const { locks, secret: before } = await loadFolderLocksAndSecret(fastify, request, userId);
            assertCanLock(before);
            const { generation } = await replaceLockSecret(userId, account_password, secret);
            // This session keeps its open locks. Not when another save came in between: that one closed them.
            const kept = generation === before.generation + 1 ? locks.openLockIds : [];

            setVaultCookie(fastify, reply, userId, kept, generation);

            return toVaultStatus(await fetchLockSecretState(userId), kept.length > 0);
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

            return toVaultStatus(await fetchLockSecretState(request.user.id), false);
        },
    );
}

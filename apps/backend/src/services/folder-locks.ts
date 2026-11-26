import { FolderLockedError } from '@reverie/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { JwtPayload } from '../app/plugins/auth.js';
import { env } from '../config/env.js';
import { db } from '../db/kysely.js';
import type { Database } from '../db/schema.js';
import type { FolderNode, FolderTree } from './folders/snapshot.js';
import { fetchLockSecretState } from './lock-secret.js';
import { loadLockMap, toLockMap, type LockMap } from './privacy.js';

/**
 * Folder locks: which private folders the current app session has opened.
 *
 * The outermost private folder of a branch is one lock, covering everything beneath it. Unlocking
 * takes the lock secret (or the account password, see lock-secret.ts) and adds that lock's id to a
 * JWT (scope 'vault') kept in an httpOnly session cookie. The cookie has no maxAge, so it ends with
 * the app/browser session, and logout clears it. Which locks are open is kept nowhere else. The JWT
 * also names the lock secret's generation, so saving a secret closes the locks of every cookie
 * signed before it.
 *
 * Only ids that are still a current lock count, so moving a private folder under another private
 * folder (which changes the lock that covers it) closes it again. A cookie can still name a folder
 * that stopped being a lock and becomes one again, so a change to a folder is checked with
 * `assertNoneOpenedBy`.
 */

export const VAULT_COOKIE = 'vault_session';

// The JWT lifetime is only a backstop; the real lifecycle is the session cookie plus logout.
// Kept long so an unlock never expires mid-use.
const VAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface VaultTokenPayload {
    sub: string;
    scope: 'vault';
    locks?: string[];
    /** The lock secret's generation these locks were opened under; a token without one counts as 0. */
    gen?: number;
}

export class FolderLocks {
    private readonly lockOf: LockMap;
    private readonly openLocks: ReadonlySet<string>;
    // Users without an account password have nothing to unlock with, so nothing is ever locked for them.
    private readonly enforced: boolean;

    constructor(lockOf: LockMap, openLocks: ReadonlySet<string>, enforced: boolean) {
        this.lockOf = lockOf;
        this.openLocks = openLocks;
        this.enforced = enforced;
    }

    /** Every private folder id, locked or not. */
    get privateFolderIds(): string[] {
        return Array.from(this.lockOf.keys());
    }

    /** Private folders whose lock is closed. */
    get lockedFolderIds(): string[] {
        return this.privateFolderIds.filter((id) => this.isLocked(id));
    }

    /** Lock ids that are currently open and still current, for re-signing the cookie. */
    get openLockIds(): string[] {
        return Array.from(new Set(this.lockOf.values())).filter((lockId) => this.openLocks.has(lockId));
    }

    /** The id of the lock covering a folder, or null when the folder is not private. */
    lockIdOf(folderId: string | null): string | null {
        if (folderId === null) return null;

        return this.lockOf.get(folderId) ?? null;
    }

    isPrivate(folderId: string | null): boolean {
        return this.lockIdOf(folderId) !== null;
    }

    isLocked(folderId: string | null): boolean {
        const lockId = this.lockIdOf(folderId);

        if (lockId === null || !this.enforced) return false;

        return !this.openLocks.has(lockId);
    }

    /**
     * Whether a folder's row must not be shown at all: it is locked and the lock belongs to a folder
     * above it, so it is only reachable through that folder (a locked folder hides everything beneath
     * it and keeps its own row).
     */
    isHidden(folderId: string): boolean {
        return this.isLocked(folderId) && this.lockIdOf(folderId) !== folderId;
    }

    /** Throws FolderLockedError when the folder is private and its lock is closed. */
    assertOpen(folderId: string | null): void {
        if (this.isLocked(folderId)) throw new FolderLockedError(folderId!);
    }

    /** assertOpen for several folders (a document batch can span folders). */
    assertAllOpen(folderIds: Iterable<string | null>): void {
        for (const folderId of folderIds) this.assertOpen(folderId);
    }

    /**
     * Guards a change that puts folders behind the lock `lockId` (null: none). When this session has that lock
     * open, the change would open each of them that is locked now, so none may be.
     */
    assertNoneOpenedBy(lockId: string | null, folderIds: Iterable<string>): void {
        if (lockId !== null && this.openLocks.has(lockId)) this.assertAllOpen(folderIds);
    }
}

function readOpenLocks(fastify: FastifyInstance, request: FastifyRequest, userId: string, generation: number): string[] {
    const token = request.cookies?.[VAULT_COOKIE];

    if (!token) return [];

    try {
        const decoded = fastify.jwt.verify<VaultTokenPayload>(token);

        if (decoded.scope !== 'vault' || decoded.sub !== userId || (decoded.gen ?? 0) !== generation) return [];

        return decoded.locks ?? [];
    } catch {
        return [];
    }
}

/**
 * The lock state of the request's user: their private folders and which locks this session opened. A caller that
 * already read the folder tree passes it, so the locks describe the same moment and the table is read once. One
 * inside a transaction passes that too, so no second connection is needed while it holds locks.
 */
export async function loadFolderLocks(
    fastify: FastifyInstance,
    request: FastifyRequest,
    userId: string,
    tree?: FolderTree<FolderNode>,
    conn: Kysely<Database> = db,
): Promise<FolderLocks> {
    const [lockOf, secret] = await Promise.all([tree ? toLockMap(tree) : loadLockMap(userId, conn), fetchLockSecretState(userId, conn)]);

    return new FolderLocks(lockOf, new Set(readOpenLocks(fastify, request, userId, secret.generation)), secret.enforced);
}

/** Set the session cookie carrying exactly these open locks, opened under this generation of the lock secret. */
export function setVaultCookie(fastify: FastifyInstance, reply: FastifyReply, userId: string, lockIds: string[], generation: number): void {
    // The signing payload type is fixed by the @fastify/jwt augmentation (JwtPayload);
    // the vault token carries a distinct shape, so cast at the boundary.
    const payload: VaultTokenPayload = { sub: userId, scope: 'vault', locks: lockIds, gen: generation };
    const token = fastify.jwt.sign(payload as unknown as JwtPayload, { expiresIn: VAULT_TTL_SECONDS });

    reply.setCookie(VAULT_COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}

export function clearVaultCookie(reply: FastifyReply): void {
    reply.clearCookie(VAULT_COOKIE, { path: '/' });
}

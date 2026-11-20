import { FolderLockedError } from '@reverie/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../app/plugins/auth.js';
import { env } from '../config/env.js';
import { db } from '../db/kysely.js';
import { loadLockMap, type LockMap } from './privacy.js';

/**
 * Folder locks: which private folders the current app session has opened.
 *
 * Every private folder (or private collection, which covers its folders) is one lock. Unlocking
 * asks for the account password and adds that lock's id to a JWT (scope 'vault') kept in an
 * httpOnly session cookie. The cookie has no maxAge, so it ends with the app/browser session, and
 * logout clears it. Nothing is stored on the server: the cookie is the whole state.
 *
 * Only ids that are still a current lock count, so moving a folder under a private collection
 * (which changes the lock that covers it) closes it again.
 */

export const VAULT_COOKIE = 'vault_session';

// The JWT lifetime is only a backstop; the real lifecycle is the session cookie plus logout.
// Kept long so an unlock never expires mid-use.
const VAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface VaultTokenPayload {
    sub: string;
    scope: 'vault';
    locks?: string[];
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
     * Whether a folder's row must not be shown at all: it is locked and the lock belongs to its
     * collection, so the folder is only reachable through the collection (a locked collection hides
     * its folders; a locked folder in a public collection keeps its own row).
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
}

function readOpenLocks(fastify: FastifyInstance, request: FastifyRequest, userId: string): string[] {
    const token = request.cookies?.[VAULT_COOKIE];

    if (!token) return [];

    try {
        const decoded = fastify.jwt.verify<VaultTokenPayload>(token);

        if (decoded.scope !== 'vault' || decoded.sub !== userId) return [];

        return decoded.locks ?? [];
    } catch {
        return [];
    }
}

export async function fetchHasPassword(userId: string): Promise<boolean> {
    const user = await db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirst();

    return !!user?.password_hash;
}

/** The lock state of the request's user: their private folders and which locks this session opened. */
export async function loadFolderLocks(fastify: FastifyInstance, request: FastifyRequest, userId: string): Promise<FolderLocks> {
    const [lockOf, enforced] = await Promise.all([loadLockMap(userId), fetchHasPassword(userId)]);

    return new FolderLocks(lockOf, new Set(readOpenLocks(fastify, request, userId)), enforced);
}

/** Set the session cookie carrying exactly these open locks. */
export function setVaultCookie(fastify: FastifyInstance, reply: FastifyReply, userId: string, lockIds: string[]): void {
    // The signing payload type is fixed by the @fastify/jwt augmentation (JwtPayload);
    // the vault token carries a distinct shape, so cast at the boundary.
    const token = fastify.jwt.sign({ sub: userId, scope: 'vault', locks: lockIds } as unknown as JwtPayload, { expiresIn: VAULT_TTL_SECONDS });

    reply.setCookie(VAULT_COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}

export function clearVaultCookie(reply: FastifyReply): void {
    reply.clearCookie(VAULT_COOKIE, { path: '/' });
}

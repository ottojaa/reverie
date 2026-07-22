import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../app/plugins/auth.js';
import { db } from '../db/kysely.js';

/**
 * Vault = the server-enforced lock over private items.
 *
 * Private items always appear in listings, but list/detail/thumbnail endpoints withhold
 * their content (file_url, thumbnails, summaries, location) unless a valid vault session
 * cookie is present. The session is a JWT (scope 'vault') set as an httpOnly session
 * cookie after the user re-enters their account password. It has no idle timeout — it
 * lasts until the app/browser session ends (session cookie), the user logs out (cookie
 * cleared), or the user explicitly locks. Search always excludes private items regardless.
 */

export const VAULT_COOKIE = 'vault_session';

// JWT lifetime is only a backstop; the real lifecycle is the session cookie (no maxAge)
// plus explicit lock / logout. Kept long so a session never re-locks mid-use.
export const VAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface VaultTokenPayload {
    sub: string;
    scope: 'vault';
    exp: number; // seconds since epoch (set by jwt)
}

/** Sign a vault-session token for the given user. */
export function signVaultToken(fastify: FastifyInstance, userId: string): string {
    // The signing payload type is fixed by the @fastify/jwt augmentation (JwtPayload);
    // the vault token carries a distinct shape, so cast at the boundary.
    return fastify.jwt.sign({ sub: userId, scope: 'vault' } as unknown as JwtPayload, { expiresIn: VAULT_TTL_SECONDS });
}

/**
 * Whether a valid vault session is present on the request. Returns false for a
 * missing/expired/invalid token, a token for a different user, or a non-vault token
 * (so an access token can't be replayed as a vault session).
 */
export function isVaultUnlocked(fastify: FastifyInstance, request: FastifyRequest, userId: string): boolean {
    const token = request.cookies?.[VAULT_COOKIE];

    if (!token) return false;

    try {
        const decoded = fastify.jwt.verify<VaultTokenPayload>(token);

        return decoded.scope === 'vault' && decoded.sub === userId;
    } catch {
        return false;
    }
}

/**
 * Whether private items should be locked (content withheld) for this caller. Locked when
 * the vault is not unlocked AND the user has an account password to unlock with. Users
 * without a password cannot unlock, so their private items are never locked (they stay
 * openable) — otherwise they'd be permanently shut out of their own content.
 */
export async function isVaultLocked(fastify: FastifyInstance, request: FastifyRequest, userId: string): Promise<boolean> {
    if (isVaultUnlocked(fastify, request, userId)) return false;

    const user = await db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirst();

    return !!user?.password_hash;
}

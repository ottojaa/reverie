import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../app/plugins/auth.js';
import { db } from '../db/kysely.js';

/**
 * Vault = the server-enforced lock over private items.
 *
 * When a user turns on "hide private items", list/tree endpoints withhold private
 * folders/documents until a valid vault session cookie is present. The session is a
 * short-lived JWT (scope 'vault') set as an httpOnly cookie after the user re-enters
 * their account password. Search always excludes private items regardless of this.
 */

export const VAULT_COOKIE = 'vault_session';
export const VAULT_TTL_SECONDS = 15 * 60; // 15 minutes

interface VaultTokenPayload {
    sub: string;
    scope: 'vault';
    exp: number; // seconds since epoch (set by jwt)
}

/** Sign a short-lived vault-session token for the given user. */
export function signVaultToken(fastify: FastifyInstance, userId: string): string {
    // The signing payload type is fixed by the @fastify/jwt augmentation (JwtPayload);
    // the vault token carries a distinct shape, so cast at the boundary.
    return fastify.jwt.sign({ sub: userId, scope: 'vault' } as unknown as JwtPayload, { expiresIn: VAULT_TTL_SECONDS });
}

/**
 * Read + verify the vault session from the request cookie. Returns unlocked=false for a
 * missing/expired/invalid token, a token for a different user, or a non-vault token
 * (so an access token can't be replayed as a vault session).
 */
export function readVaultSession(fastify: FastifyInstance, request: FastifyRequest, userId: string): { unlocked: boolean; expiresAt: string | null } {
    const token = request.cookies?.[VAULT_COOKIE];

    if (!token) return { unlocked: false, expiresAt: null };

    try {
        const decoded = fastify.jwt.verify<VaultTokenPayload>(token);

        if (decoded.scope !== 'vault' || decoded.sub !== userId) {
            return { unlocked: false, expiresAt: null };
        }

        return { unlocked: true, expiresAt: new Date(decoded.exp * 1000).toISOString() };
    } catch {
        return { unlocked: false, expiresAt: null };
    }
}

/**
 * Whether the caller should see private items in list/tree endpoints.
 * Private items are visible unless the user has enabled hiding AND the vault is locked.
 */
export async function resolveShowPrivate(fastify: FastifyInstance, request: FastifyRequest, userId: string): Promise<boolean> {
    if (readVaultSession(fastify, request, userId).unlocked) return true;

    const user = await db.selectFrom('users').select('hide_private').where('id', '=', userId).executeTakeFirst();

    return !user?.hide_private;
}

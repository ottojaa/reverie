import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/kysely.js';
import type { ApiToken, ApiTokenKind } from '../db/schema.js';

/**
 * API tokens: long-lived, revocable secrets a user hands to a tool such as Claude Code. The secret
 * is shown once, at creation; only its SHA-256 is stored. The secret is 256 random bits, so a fast
 * hash is enough (a slow one defends guessable passwords, which these are not).
 *
 * Nothing here caches a verification: a revoked token fails on the very next request.
 */

export const TOKEN_SECRET_PREFIX = 'rvr_';
const LISTED_PREFIX_LENGTH = TOKEN_SECRET_PREFIX.length + 8;

export function hashToken(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

function toSecret(): string {
    return TOKEN_SECRET_PREFIX + randomBytes(32).toString('base64url');
}

export interface CreatedApiToken {
    token: ApiToken;
    /** The only time the secret exists outside the caller's hands. */
    secret: string;
}

export interface CreateApiTokenOptions {
    kind?: ApiTokenKind;
    expiresAt?: Date;
}

export async function createApiToken(userId: string, name: string, options: CreateApiTokenOptions = {}): Promise<CreatedApiToken> {
    const secret = toSecret();
    const token = await db
        .insertInto('api_tokens')
        .values({
            user_id: userId,
            name,
            token_hash: hashToken(secret),
            token_prefix: secret.slice(0, LISTED_PREFIX_LENGTH),
            kind: options.kind,
            expires_at: options.expiresAt ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return { token, secret };
}

/** The user's own tokens that can still be used and that they created themselves (newest first). */
export async function listApiTokens(userId: string): Promise<ApiToken[]> {
    return db
        .selectFrom('api_tokens')
        .selectAll()
        .where('user_id', '=', userId)
        .where('kind', '=', 'personal')
        .where('revoked_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute();
}

/** Revoke one of the user's tokens. False when it does not exist, is not theirs, or is already revoked. */
export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
    const result = await db
        .updateTable('api_tokens')
        .set({ revoked_at: new Date() })
        .where('id', '=', tokenId)
        .where('user_id', '=', userId)
        .where('kind', '=', 'personal')
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
}

export interface VerifiedToken {
    tokenId: string;
    user: { id: string; email: string };
}

/** The user behind a secret, or null for an unknown, revoked or expired token or a deactivated user. */
export async function verifyApiToken(secret: string): Promise<VerifiedToken | null> {
    if (!secret.startsWith(TOKEN_SECRET_PREFIX)) return null;

    const row = await db
        .selectFrom('api_tokens')
        .innerJoin('users', 'users.id', 'api_tokens.user_id')
        .select(['api_tokens.id as token_id', 'users.id as user_id', 'users.email as email'])
        .where('api_tokens.token_hash', '=', hashToken(secret))
        .where('api_tokens.revoked_at', 'is', null)
        .where((eb) => eb.or([eb('api_tokens.expires_at', 'is', null), eb('api_tokens.expires_at', '>', new Date())]))
        .where('users.is_active', '=', true)
        .executeTakeFirst();

    if (!row) return null;

    await touchLastUsed(row.token_id);

    return { tokenId: row.token_id, user: { id: row.user_id, email: row.email } };
}

/** At most one write per token per minute, decided in SQL so it holds across processes. */
async function touchLastUsed(tokenId: string): Promise<void> {
    await db
        .updateTable('api_tokens')
        .set({ last_used_at: new Date() })
        .where('id', '=', tokenId)
        .where((eb) => eb.or([eb('last_used_at', 'is', null), eb('last_used_at', '<', sql<Date>`now() - interval '1 minute'`)]))
        .execute();
}

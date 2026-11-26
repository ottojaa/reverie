import { z } from 'zod';
import { UuidSchema } from './common.js';

/**
 * Folder locks: each private folder is a lock over itself and everything beneath it, however deep
 * (a private folder inside another one belongs to the outer lock; see Folder.lock_id). Unlocking
 * takes the user's lock secret (a PIN or a password of its own, the same for every lock) and opens
 * exactly that one lock for the app session (an httpOnly session cookie that lasts until app quit
 * or logout; there is no idle timeout). With no lock secret set, the account password opens them.
 * Private documents are never returned outside their own folder, locked or not: not in "All
 * documents", search, facets, suggestions or counts. Users without an account password cannot lock
 * (nothing to unlock with, or to reset a lock secret with), so their private folders stay openable.
 */

export const LockSecretKindSchema = z.enum(['pin', 'password']);

export type LockSecretKind = z.infer<typeof LockSecretKindSchema>;

/** What a prompt for a folder lock asks for. */
export const LockAskSchema = z.enum(['pin', 'password', 'account_password']);

export type LockAsk = z.infer<typeof LockAskSchema>;

// POST /vault/unlock: open one folder's lock. `password` is whatever was typed into the prompt, a
// PIN included: the server checks it against the one secret the status' `ask` names.
// `folder_id` is any folder behind the lock to open (a trashed one is accepted too, so it
// can be browsed and restored from the trash).
export const VaultUnlockRequestSchema = z.object({
    password: z.string().min(1),
    folder_id: UuidSchema,
});

export type VaultUnlockRequest = z.infer<typeof VaultUnlockRequestSchema>;

// GET /vault/status — and the response of unlock/lock.
export const VaultStatusSchema = z.object({
    // Whether at least one folder lock is currently open in this session.
    unlocked: z.boolean(),
    // Whether the user has an account password to unlock with. OAuth-only users
    // (no password_hash) cannot lock/unlock; the UI uses this to nudge them to set one.
    has_password: z.boolean(),
    // The kind of lock secret the user has set; null when there is none.
    secret_kind: LockSecretKindSchema.nullable(),
    // What to ask for now: the lock secret's kind, or the account password when none is set or
    // too many wrong tries have stopped it. Null when has_password is false.
    ask: LockAskSchema.nullable(),
});

export type VaultStatus = z.infer<typeof VaultStatusSchema>;

export const LockSecretSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('pin'), value: z.string().regex(/^\d{4}$/, 'A PIN is exactly four digits') }),
    z.object({ kind: z.literal('password'), value: z.string().min(4).max(128) }),
]);

export type LockSecret = z.infer<typeof LockSecretSchema>;

// PUT /vault/secret: set, change or remove (`secret: null`) the lock secret. Always proven with the
// account password, never with the old lock secret, so it also resets a forgotten one.
export const VaultSecretRequestSchema = z.object({
    account_password: z.string().min(1),
    secret: LockSecretSchema.nullable(),
});

export type VaultSecretRequest = z.infer<typeof VaultSecretRequestSchema>;

// A wrong try that the server counts, or a wrong account password when saving a lock secret. A 403,
// never a 401: clients answer a 401 by renewing the login and sending the request again.
export const VaultRefusalSchema = z.object({
    statusCode: z.literal(403),
    error: z.literal('invalid_credentials'),
    message: z.string(),
    details: z.object({
        // What to ask for next.
        ask: LockAskSchema,
        // Wrong tries left before the lock secret is stopped; null when this try is not counted.
        tries_left: z.number().int().positive().nullable(),
    }),
});

export type VaultRefusal = z.infer<typeof VaultRefusalSchema>;

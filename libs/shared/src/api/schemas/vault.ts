import { z } from 'zod';

/**
 * Vault = the server-enforced lock over private items.
 *
 * Private items (is_private, or effectively private via a private collection/folder)
 * always appear in listings, but the backend withholds their content — file_url,
 * thumbnails, summaries, location — until the user unlocks by re-entering their
 * account password. Each locked item carries `locked: true`; clients show a lock
 * affordance and prompt to unlock on open. Unlocking grants a session-lived vault
 * session (httpOnly session cookie) that lasts until app quit, logout, or explicit
 * lock — there is no idle timeout. Search always excludes private items regardless
 * of vault state. Users without an account password cannot lock (nothing to unlock
 * with), so their private items stay openable.
 */

// POST /vault/unlock — re-enter the account login password to unlock private items.
export const VaultUnlockRequestSchema = z.object({
    password: z.string().min(1),
});

export type VaultUnlockRequest = z.infer<typeof VaultUnlockRequestSchema>;

// GET /vault/status — and the response of unlock/lock.
export const VaultStatusSchema = z.object({
    // Whether a valid vault session is currently active (private items unlocked).
    unlocked: z.boolean(),
    // Whether the user has an account password to unlock with. OAuth-only users
    // (no password_hash) cannot lock/unlock; the UI uses this to nudge them to set one.
    has_password: z.boolean(),
});

export type VaultStatus = z.infer<typeof VaultStatusSchema>;

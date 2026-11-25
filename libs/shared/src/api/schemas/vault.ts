import { z } from 'zod';
import { UuidSchema } from './common.js';

/**
 * Folder locks: each private folder is a lock over itself and everything beneath it, however deep
 * (a private folder inside another one belongs to the outer lock; see Folder.lock_id). Unlocking
 * asks for the account password and opens exactly that one lock for the app
 * session (an httpOnly session cookie that lasts until app quit or logout; there is no idle
 * timeout). Private documents are never returned outside their own folder, locked or not: not
 * in "All documents", search, facets, suggestions or counts. Users without an account password
 * cannot lock (nothing to unlock with), so their private folders stay openable.
 */

// POST /vault/unlock: re-enter the account login password to open one folder's lock.
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
});

export type VaultStatus = z.infer<typeof VaultStatusSchema>;

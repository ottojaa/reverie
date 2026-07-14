import { z } from 'zod';

/**
 * Vault = the server-enforced lock over private items.
 *
 * When a user turns on "hide private items", the backend withholds private
 * folders/documents from the sidebar/browse/list endpoints until the user
 * unlocks by re-entering their account password, which grants a short-lived
 * vault session (httpOnly cookie). Search always excludes private items,
 * regardless of vault state.
 */

// POST /vault/unlock — re-enter the account login password to reveal private items.
export const VaultUnlockRequestSchema = z.object({
    password: z.string().min(1),
});

export type VaultUnlockRequest = z.infer<typeof VaultUnlockRequestSchema>;

// PATCH /vault/settings — toggle the "hide private items" mode.
// Turning it OFF requires an unlocked session (enforced server-side).
export const VaultSettingsRequestSchema = z.object({
    hide_private: z.boolean(),
});

export type VaultSettingsRequest = z.infer<typeof VaultSettingsRequestSchema>;

// GET /vault/status — and the response of unlock/lock/settings.
export const VaultStatusSchema = z.object({
    // Whether the user has enabled hiding private items from the sidebar.
    hide_enabled: z.boolean(),
    // Whether a valid vault session is currently active (private items revealed).
    unlocked: z.boolean(),
    // When the current vault session expires (null when locked).
    expires_at: z.string().datetime().nullable(),
    // Whether the user has an account password to unlock with. OAuth-only users
    // (no password_hash) cannot unlock; the UI uses this to explain why.
    has_password: z.boolean(),
});

export type VaultStatus = z.infer<typeof VaultStatusSchema>;

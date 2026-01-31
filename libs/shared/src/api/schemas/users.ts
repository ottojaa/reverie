import { z } from 'zod';
import { DateStringSchema, UuidSchema } from './common.js';

// User entity schema (public-facing, excludes password_hash)
export const UserSchema = z.object({
    id: UuidSchema,
    email: z.string().email(),
    display_name: z.string().min(1).max(100),
    storage_quota_bytes: z.number(),
    storage_used_bytes: z.number(),
    is_active: z.boolean(),
    created_at: DateStringSchema,
    last_login_at: DateStringSchema.nullable(),
});

export type User = z.infer<typeof UserSchema>;

// User with storage info (for settings/profile pages)
export const UserProfileSchema = UserSchema.extend({
    storage_quota_formatted: z.string(), // e.g., "500 GB"
    storage_used_formatted: z.string(), // e.g., "12.5 GB"
    storage_used_percentage: z.number(), // e.g., 2.5
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

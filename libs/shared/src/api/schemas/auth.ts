import { z } from 'zod';
import { UserSchema } from './users.js';

// Login request
export const LoginRequestSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// Login response (tokens + user)
export const LoginResponseSchema = z.object({
    user: UserSchema,
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number(), // seconds until access_token expires
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// Refresh token request
export const RefreshTokenRequestSchema = z.object({
    refresh_token: z.string(),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

// Refresh token response
export const RefreshTokenResponseSchema = z.object({
    access_token: z.string(),
    expires_in: z.number(),
});

export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>;

// Change password request
export const ChangePasswordRequestSchema = z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(8).max(128),
});

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// Google OAuth callback query
export const GoogleCallbackQuerySchema = z.object({
    code: z.string(),
    state: z.string().optional(),
});

export type GoogleCallbackQuery = z.infer<typeof GoogleCallbackQuerySchema>;

// Auth error response
export const AuthErrorSchema = z.object({
    error: z.enum(['invalid_credentials', 'account_disabled', 'token_expired', 'token_invalid', 'google_account_not_linked', 'password_mismatch']),
    message: z.string(),
});

export type AuthError = z.infer<typeof AuthErrorSchema>;

// Current user response (from /auth/me)
export const CurrentUserResponseSchema = z.object({
    user: UserSchema,
});

export type CurrentUserResponse = z.infer<typeof CurrentUserResponseSchema>;

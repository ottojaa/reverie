import { z } from 'zod';
import { DateStringSchema, UuidSchema } from './common.js';

// A token as listed: never carries the secret, only enough to tell tokens apart.
export const ApiTokenSchema = z.object({
    id: UuidSchema,
    name: z.string(),
    // First characters of the secret, so the owner can recognise a token in the list.
    prefix: z.string(),
    created_at: DateStringSchema,
    last_used_at: DateStringSchema.nullable(),
});

export type ApiToken = z.infer<typeof ApiTokenSchema>;

export const ListApiTokensResponseSchema = z.object({
    tokens: z.array(ApiTokenSchema),
});

export type ListApiTokensResponse = z.infer<typeof ListApiTokensResponseSchema>;

export const CreateApiTokenRequestSchema = z.object({
    name: z.string().trim().min(1).max(100),
});

export type CreateApiTokenRequest = z.infer<typeof CreateApiTokenRequestSchema>;

// The only response that ever contains the secret.
export const CreateApiTokenResponseSchema = z.object({
    token: ApiTokenSchema,
    secret: z.string(),
});

export type CreateApiTokenResponse = z.infer<typeof CreateApiTokenResponseSchema>;

export const ApiTokenParamsSchema = z.object({
    id: UuidSchema,
});

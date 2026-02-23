import { z } from 'zod';
import { UserSchema } from './users.js';

export const ListUsersResponseSchema = z.object({
    users: z.array(UserSchema),
});

export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;

export const UpdateUserRequestSchema = z.object({
    email: z.string().email().optional(),
    display_name: z.string().min(1).max(100).optional(),
    quota: z.string().regex(/^\d+(?:\.\d+)?\s*(GB|TB)$/i, 'Use format like 500GB or 1TB').optional(),
});

export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const UpdateUserResponseSchema = z.object({
    user: UserSchema,
});

export type UpdateUserResponse = z.infer<typeof UpdateUserResponseSchema>;

export const CreateUserRequestSchema = z.object({
    email: z.string().email(),
    display_name: z.string().min(1).max(100),
    password: z.string().min(8).max(128).optional(),
    quota: z.string().regex(/^\d+(?:\.\d+)?\s*(GB|TB)$/i, 'Use format like 500GB or 1TB'),
});

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const CreateUserResponseSchema = z.object({
    user: UserSchema,
    password: z.string().optional(),
});

export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;

import { z } from 'zod';

// Common response schemas
export const ApiErrorSchema = z.object({
    statusCode: z.number(),
    error: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/** For a status that a route answers with its own `{ error, message }` and the server's error handler with its envelope. */
export const RouteErrorSchema = ApiErrorSchema.extend({ statusCode: z.number().optional(), details: z.unknown().optional() });

// Pagination
export const PaginationQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
    z.object({
        items: z.array(itemSchema),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
    });

// UUID validation
export const UuidSchema = z.string().uuid();

// Date helpers
export const DateStringSchema = z.string().datetime();
export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');

// Not z.coerce.boolean(): that turns the query-string "false" into true.
export const QueryFlagSchema = z.union([z.boolean(), z.string().transform((v) => v === 'true' || v === '1')]);

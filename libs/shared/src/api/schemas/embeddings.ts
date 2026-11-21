import { z } from 'zod';

// Read-only status of the local embedding pipeline, for the admin settings page.

export const EmbeddingModelInfoSchema = z.object({
    name: z.string(),
    revision: z.string(),
    dimensions: z.number().int(),
});

export const EmbeddingCountsSchema = z.object({
    /** Live documents that should have this kind of embedding. */
    eligible: z.number().int(),
    /** Of those, how many have one for the model the service runs now. */
    embedded: z.number().int(),
});

export const EmbeddingBackfillStateSchema = z.enum(['running', 'idle']);

export const EmbeddingStatusResponseSchema = z.object({
    /** False when ML_URL is unset: nothing is embedded and nothing is queued. */
    enabled: z.boolean(),
    ml: z.object({
        /** True once the service answers and both models are loaded. */
        ready: z.boolean(),
        reachable: z.boolean(),
        device: z.string().nullable(),
        error: z.string().nullable(),
        text: EmbeddingModelInfoSchema.nullable(),
        image: EmbeddingModelInfoSchema.nullable(),
    }),
    text: EmbeddingCountsSchema,
    image: EmbeddingCountsSchema,
    queue: z.object({ waiting: z.number().int(), active: z.number().int(), delayed: z.number().int(), failed: z.number().int() }),
    /** `running` while the backfill job exists in the queue (waiting, active or delayed); `idle` once it has finished. */
    backfill: EmbeddingBackfillStateSchema,
});

export type EmbeddingStatusResponse = z.infer<typeof EmbeddingStatusResponseSchema>;

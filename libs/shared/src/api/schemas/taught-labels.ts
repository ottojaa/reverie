import { z } from 'zod';
import { PaginationQuerySchema, UuidSchema } from './common.js';
import { DocumentSearchResultSchema } from './search.js';

// Labels taught by example: the user marks a few images with a label of their own and every image whose
// embedding sits near them gets it as a "taught" tag.

export const TaughtLabelSchema = z.object({
    id: UuidSchema,
    /** The tag text it puts on images. */
    name: z.string(),
    /** Cosine similarity (0..1) an image must reach to its nearest example. */
    threshold: z.number(),
    /** False while the threshold still follows the examples' own spread. */
    threshold_is_custom: z.boolean(),
    /** Examples and matches the owner can see (live images outside private folders). */
    example_count: z.number().int(),
    match_count: z.number().int(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});
export type TaughtLabel = z.infer<typeof TaughtLabelSchema>;

export const TaughtLabelListResponseSchema = z.object({ labels: z.array(TaughtLabelSchema) });
export type TaughtLabelListResponse = z.infer<typeof TaughtLabelListResponseSchema>;

export const TeachLabelRequestSchema = z.object({
    /** An existing label's name adds the images to it; a new name creates the label. */
    name: z.string().trim().min(1).max(60),
    document_ids: z.array(UuidSchema).min(1).max(500),
});
export type TeachLabelRequest = z.infer<typeof TeachLabelRequestSchema>;

export const AddExamplesRequestSchema = z.object({ document_ids: z.array(UuidSchema).min(1).max(500) });
export type AddExamplesRequest = z.infer<typeof AddExamplesRequestSchema>;

export const TeachLabelResponseSchema = z.object({
    label: TaughtLabelSchema,
    /** Images that became examples. */
    added: z.number().int(),
    /** Selected documents that were not images and so can't teach a label. */
    skipped: z.number().int(),
});
export type TeachLabelResponse = z.infer<typeof TeachLabelResponseSchema>;

export const UpdateTaughtLabelRequestSchema = z.object({ threshold: z.number().min(0.5).max(1) });
export type UpdateTaughtLabelRequest = z.infer<typeof UpdateTaughtLabelRequestSchema>;

/** Paginates the label's matches. */
export const TaughtLabelDetailQuerySchema = PaginationQuerySchema;
export type TaughtLabelDetailQuery = z.infer<typeof TaughtLabelDetailQuerySchema>;

export const TaughtLabelDetailResponseSchema = z.object({
    label: TaughtLabelSchema,
    examples: z.array(DocumentSearchResultSchema),
    matches: z.array(DocumentSearchResultSchema),
    match_total: z.number().int(),
});
export type TaughtLabelDetailResponse = z.infer<typeof TaughtLabelDetailResponseSchema>;

/**
 * Best similarity to any example of every image the label could match (not trashed, outside private folders,
 * not excluded), most similar first, from `floor` up. The manager counts a threshold against this list.
 */
export const TaughtLabelSimilaritiesResponseSchema = z.object({
    similarities: z.array(z.number()),
    /** The lowest similarity listed; a threshold under it can't be counted exactly. */
    floor: z.number(),
    /** True when the list was cut at its size cap (the lowest similarities are missing). */
    truncated: z.boolean(),
});
export type TaughtLabelSimilaritiesResponse = z.infer<typeof TaughtLabelSimilaritiesResponseSchema>;

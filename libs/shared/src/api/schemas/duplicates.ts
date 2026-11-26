import { z } from 'zod';
import { UuidSchema } from './common.js';
import { ThumbnailUrlsSchema } from './documents.js';

/**
 * Near-duplicate detection: groups of images that are the same picture or nearly so. A group is never stored: it is built from the
 * stored similar pairs when asked for, so its id (a hash of its members) changes when the members do, and an action on an old id is refused.
 */

export const DuplicateMemberSchema = z.object({
    id: UuidSchema,
    filename: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    /** When the picture was taken, else when it was uploaded. */
    date: z.string().datetime(),
    folder_id: UuidSchema.nullable(),
    folder_path: z.string().nullable(),
    thumbnail_blurhash: z.string().nullable(),
    thumbnail_urls: ThumbnailUrlsSchema.nullable(),
});
export type DuplicateMember = z.infer<typeof DuplicateMemberSchema>;

export const DuplicateGroupSchema = z.object({
    id: z.string(),
    members: z.array(DuplicateMemberSchema).min(2),
    /** The copy to keep unless the owner picks another: largest resolution, then an original over an edited copy, then the oldest. */
    suggested_keep_id: UuidSchema,
    /** The lowest similarity between two members; 1 when they are byte-identical files. */
    min_similarity: z.number(),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroupSchema>;

// GET /duplicates
export const DuplicatesQuerySchema = z.object({
    /** Any folder behind a lock: lists the duplicates inside that lock (it must be open). Without it, only images outside private folders. */
    folder_id: UuidSchema.optional(),
});
export type DuplicatesQuery = z.infer<typeof DuplicatesQuerySchema>;

export const DuplicatesResponseSchema = z.object({
    groups: z.array(DuplicateGroupSchema),
    /** The similarity two images must reach to be listed. */
    threshold: z.number(),
});
export type DuplicatesResponse = z.infer<typeof DuplicatesResponseSchema>;

// POST /duplicates/trash-others
export const TrashOthersRequestSchema = z.object({
    folder_id: UuidSchema.optional(),
    groups: z
        .array(z.object({ group_id: z.string().min(1), keep_id: UuidSchema }))
        .min(1)
        .max(500),
});
export type TrashOthersRequest = z.infer<typeof TrashOthersRequestSchema>;

export const TrashOthersResponseSchema = z.object({
    /** Every image moved to the Trash; restoring them undoes the call. */
    trashed_ids: z.array(UuidSchema),
    /** Groups left alone because they changed since the list was loaded, or the image to keep is not in them. */
    skipped_group_ids: z.array(z.string()),
});
export type TrashOthersResponse = z.infer<typeof TrashOthersResponseSchema>;

// POST /duplicates/dismiss
export const DismissDuplicatesRequestSchema = z.object({
    folder_id: UuidSchema.optional(),
    group_id: z.string().min(1),
});
export type DismissDuplicatesRequest = z.infer<typeof DismissDuplicatesRequestSchema>;

export const DismissDuplicatesResponseSchema = z.object({ dismissed: z.boolean() });
export type DismissDuplicatesResponse = z.infer<typeof DismissDuplicatesResponseSchema>;

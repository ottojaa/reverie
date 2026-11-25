import { z } from 'zod';
import { UuidSchema } from './common.js';
import { DocumentSchema } from './documents.js';
import { FolderCoverSchema, FolderSchema } from './folders.js';

/** What can be starred. Collections count as folders. */
export const FavouriteTypeSchema = z.enum(['folder', 'document']);

export type FavouriteType = z.infer<typeof FavouriteTypeSchema>;

export const FavouriteFolderSchema = FolderSchema.extend({
    document_count: z.number(),
    /** As in the folder tree: null for collections. */
    cover: FolderCoverSchema.nullable(),
});

export type FavouriteFolder = z.infer<typeof FavouriteFolderSchema>;

/** One parent of a favourite. */
export const FavouriteLocationSchema = z.object({
    id: UuidSchema,
    name: z.string(),
});

export type FavouriteLocation = z.infer<typeof FavouriteLocationSchema>;

/**
 * One starred item. A private one (a private folder or collection, anything inside one) is anonymous, whether
 * or not its lock is open: `location`, `folder` and `document` are all null. Otherwise exactly one of
 * `folder` and `document` is set, matching `type`.
 */
export const FavouriteSchema = z.object({
    type: FavouriteTypeSchema,
    id: UuidSchema,
    starred_at: z.string().datetime(),
    private: z.boolean(),
    /** Private and its lock is closed in this session. */
    locked: z.boolean(),
    /** The folder id POST /vault/unlock opens to reach a private item; null for other items. */
    lock_id: UuidSchema.nullable(),
    /** The chain of parents, collection first. */
    location: z.array(FavouriteLocationSchema).nullable(),
    folder: FavouriteFolderSchema.nullable(),
    document: DocumentSchema.nullable(),
});

export type Favourite = z.infer<typeof FavouriteSchema>;

/** Every favourite, newest-starred first. */
export const FavouriteListResponseSchema = z.object({
    items: z.array(FavouriteSchema),
});

export type FavouriteListResponse = z.infer<typeof FavouriteListResponseSchema>;

export const SetFavouriteRequestSchema = z.object({
    is_favourite: z.boolean(),
});

export type SetFavouriteRequest = z.infer<typeof SetFavouriteRequestSchema>;

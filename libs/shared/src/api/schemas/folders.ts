import { z } from 'zod';
import { UuidSchema } from './common.js';
import { DocumentSummaryResponseSchema } from './documents.js';

/** Folders hold documents and other folders, to any depth, and both may sit at the top level. */

/** A name a client may give a folder. '/' separates names in a folder's path, so a name never holds it. */
export const FolderNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(255)
    // eslint-disable-next-line no-control-regex -- NUL is one of the characters being refused
    .regex(/^[^/\\\u0000]*$/, 'A folder name cannot contain "/", "\\" or NUL');

export const FolderSchema = z.object({
    id: UuidSchema,
    parent_id: UuidSchema.nullable(),
    name: z.string().min(1).max(255),
    path: z.string(),
    description: z.string().nullable(),
    emoji: z.string().max(48).nullable(),
    sort_order: z.number(),
    // Explicitly-set privacy flag on this folder. A folder anywhere beneath a private one is
    // private too, whatever this flag says; `lock_id` and `locked` already account for that.
    is_private: z.boolean(),
    // The outermost private folder among this one and those above it: what POST /vault/unlock opens to reach
    // it. Null for a public folder.
    lock_id: UuidSchema.nullable(),
    // True when this folder is effectively private AND its lock is closed (the caller has an
    // account password and has not unlocked it in this session). Clients show a padlock and ask
    // for what the vault status' `ask` names before opening it. See vault.ts.
    locked: z.boolean(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});

export type Folder = z.infer<typeof FolderSchema>;

export const CreateFolderRequestSchema = z.object({
    name: FolderNameSchema,
    /** Omitted: the folder is created at the top level. */
    parent_id: UuidSchema.optional(),
    description: z.string().optional(),
    emoji: z.string().max(48).optional(),
});

export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>;

export const UpdateFolderRequestSchema = z.object({
    name: FolderNameSchema.optional(),
    description: z.string().nullable().optional(),
    emoji: z.string().max(48).nullable().optional(),
    /** Moves the folder: into that folder, or with null to the top level. Left out, it stays where it is. */
    parent_id: UuidSchema.nullable().optional(),
    is_private: z.boolean().optional(),
});

export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequestSchema>;

export const ReorderFoldersRequestSchema = z.object({
    updates: z
        .array(
            z.object({
                id: UuidSchema,
                sort_order: z.number(),
            }),
        )
        .min(1)
        .max(500),
});

export type ReorderFoldersRequest = z.infer<typeof ReorderFoldersRequestSchema>;

/** One document shown in a folder's cover mosaic. */
export const FolderCoverTileSchema = z.object({
    document_id: UuidSchema,
    mime_type: z.string(),
    original_filename: z.string(),
    thumbnail_blurhash: z.string().nullable(),
});

export type FolderCoverTile = z.infer<typeof FolderCoverTileSchema>;

/**
 * What a folder holds, for its cover: up to four documents (screenshots and screen recordings last, then
 * thumbnailed first, then newest first) and a per-kind summary. Both are over the folder and everything beneath
 * it, leaving out whatever sits behind a lock further down.
 */
export const FolderCoverSchema = z.object({
    tiles: z.array(FolderCoverTileSchema).max(4),
    summary: DocumentSummaryResponseSchema,
});

export type FolderCover = z.infer<typeof FolderCoverSchema>;

/** How many documents of each kind (see documentKindOf) there are. */
export const KindCountsSchema = z.object({
    image: z.number().int().nonnegative(),
    video: z.number().int().nonnegative(),
    file: z.number().int().nonnegative(),
});

export type KindCounts = z.infer<typeof KindCountsSchema>;

export interface FolderWithChildren extends z.infer<typeof FolderSchema> {
    /** Empty while the folder is locked. */
    children: FolderWithChildren[];
    /**
     * Documents in this folder and everything beneath it, counting only what is behind the same lock as the folder
     * itself: nothing under a private folder counts toward a public one above it. All zero while locked.
     */
    kind_counts: KindCounts;
    /** Null for every private folder, open or not (private document ids and filenames stay out of the tree). */
    cover: FolderCover | null;
}

export const FolderWithChildrenSchema: z.ZodType<FolderWithChildren> = FolderSchema.extend({
    children: z.lazy(() => z.array(FolderWithChildrenSchema)),
    kind_counts: KindCountsSchema,
    cover: FolderCoverSchema.nullable(),
});

export const FolderTreeResponseSchema = z.array(FolderWithChildrenSchema);

export type FolderTreeResponse = z.infer<typeof FolderTreeResponseSchema>;

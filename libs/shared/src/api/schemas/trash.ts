import { z } from 'zod';
import { UuidSchema } from './common.js';
import { ThumbnailUrlsSchema } from './documents.js';
import { FolderTypeSchema } from './folders.js';

/**
 * Trash: deleted documents and folders stay recoverable until `purge_at`, then a background job
 * removes them for good. Trashed items never appear in any other listing or search.
 */

export const TrashDocumentSchema = z.object({
    id: UuidSchema,
    original_filename: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    // The folder it was in; null when it was at the top level.
    folder_id: UuidSchema.nullable(),
    // Read-only: true when the document's folder is private. Only listed while its lock is open.
    is_private: z.boolean(),
    thumbnail_blurhash: z.string().nullable(),
    thumbnail_urls: ThumbnailUrlsSchema.nullable(),
    deleted_at: z.string(),
    purge_at: z.string(),
});

export type TrashDocument = z.infer<typeof TrashDocumentSchema>;

export const TrashFolderSchema = z.object({
    id: UuidSchema,
    // Empty while `locked`: a private folder in the trash shows no name until it is unlocked.
    name: z.string(),
    /** @deprecated 'collection' for a folder that was at the top level, else 'folder'. */
    type: FolderTypeSchema,
    emoji: z.string().nullable(),
    is_private: z.boolean(),
    // True for a private folder whose lock is closed. It lists only as a bare row (no name, emoji or
    // contents) that the user can unlock to see and restore it.
    locked: z.boolean(),
    // What went to the trash with this folder and comes back with it: folders beneath it, and documents in
    // it or in those folders. Contents behind a further lock are not counted; both are 0 while locked.
    folder_count: z.number().int().nonnegative(),
    document_count: z.number().int().nonnegative(),
    deleted_at: z.string(),
    purge_at: z.string(),
});

export type TrashFolder = z.infer<typeof TrashFolderSchema>;

// GET /trash
export const TrashListResponseSchema = z.object({
    documents: z.array(TrashDocumentSchema),
    folders: z.array(TrashFolderSchema),
    retention_days: z.number().int(),
});

export type TrashListResponse = z.infer<typeof TrashListResponseSchema>;

// POST /trash/restore and POST /trash/purge
export const TrashSelectionSchema = z
    .object({
        document_ids: z.array(UuidSchema).max(500).default([]),
        folder_ids: z.array(UuidSchema).max(500).default([]),
    })
    .refine((value) => value.document_ids.length + value.folder_ids.length > 0, { message: 'Select at least one item' });

export type TrashSelection = z.input<typeof TrashSelectionSchema>;

// Response of restore, purge and empty: how many items were affected.
export const TrashResultSchema = z.object({
    documents: z.number().int(),
    folders: z.number().int(),
});

export type TrashResult = z.infer<typeof TrashResultSchema>;

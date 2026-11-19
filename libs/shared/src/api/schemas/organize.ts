import { z } from 'zod';
import { UuidSchema } from './common.js';
import { ThumbnailUrlsSchema } from './documents.js';

export const OrganizeDocumentPreviewSchema = z.object({
    id: UuidSchema,
    display_name: z.string(),
    thumbnail_urls: ThumbnailUrlsSchema.nullable(),
    mime_type: z.string(),
});

export type OrganizeDocumentPreview = z.infer<typeof OrganizeDocumentPreviewSchema>;

export const OrganizeTargetFolderSchema = z.object({
    id: UuidSchema.optional(),
    name: z.string(),
    parent_id: UuidSchema.optional(),
    /** When set, a new top-level collection with this name is created first, then the folder is nested under it */
    new_parent_name: z.string().optional(),
    is_new: z.boolean(),
});

export type OrganizeTargetFolder = z.infer<typeof OrganizeTargetFolderSchema>;

export const OrganizeMoveOperationSchema = z.object({
    type: z.enum(['move', 'create_and_move']),
    document_ids: z.array(UuidSchema).min(1),
    document_previews: z.array(OrganizeDocumentPreviewSchema),
    target_folder: OrganizeTargetFolderSchema,
});

export const OrganizeDeleteFolderOperationSchema = z.object({
    type: z.literal('delete_folder'),
    folder_id: UuidSchema,
    folder_name: z.string(),
});

export const OrganizeOperationSchema = z.discriminatedUnion('type', [OrganizeMoveOperationSchema, OrganizeDeleteFolderOperationSchema]);

export type OrganizeOperation = z.infer<typeof OrganizeOperationSchema>;

// ── Request Schemas ──────────────────────────────────────────────────────────

export const OrganizeExecuteRequestSchema = z.object({
    operations: z.array(OrganizeOperationSchema).min(1),
});

export type OrganizeExecuteRequest = z.infer<typeof OrganizeExecuteRequestSchema>;

export const OrganizeExecuteResponseSchema = z.object({
    moved_count: z.number(),
    folders_created: z.number(),
    folders_deleted: z.number(),
});

export type OrganizeExecuteResponse = z.infer<typeof OrganizeExecuteResponseSchema>;

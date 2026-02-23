import { z } from 'zod';
import { UuidSchema } from './common.js';
import { ThumbnailUrlsSchema } from './documents.js';

// ── SSE Event Types ─────────────────────────────────────────────────────────

export const OrganizeSseEventTypeSchema = z.enum(['status', 'delta', 'proposal', 'done', 'error']);
export type OrganizeSseEventType = z.infer<typeof OrganizeSseEventTypeSchema>;

export const OrganizeStatusEventSchema = z.object({
    type: z.literal('status'),
    action: z.string(),
});

export const OrganizeDeltaEventSchema = z.object({
    type: z.literal('delta'),
    content: z.string(),
});

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
    /** When set, a new top-level category with this name is created first, then the section is nested under it */
    new_parent_name: z.string().optional(),
    is_new: z.boolean(),
});

export type OrganizeTargetFolder = z.infer<typeof OrganizeTargetFolderSchema>;

export const OrganizeOperationSchema = z.object({
    type: z.enum(['move', 'create_and_move']),
    document_ids: z.array(UuidSchema).min(1),
    document_previews: z.array(OrganizeDocumentPreviewSchema),
    target_folder: OrganizeTargetFolderSchema,
});

export type OrganizeOperation = z.infer<typeof OrganizeOperationSchema>;

export const OrganizeProposalEventSchema = z.object({
    type: z.literal('proposal'),
    summary: z.string(),
    operations: z.array(OrganizeOperationSchema),
});

export type OrganizeProposalEvent = z.infer<typeof OrganizeProposalEventSchema>;

export const OrganizeDoneEventSchema = z.object({
    type: z.literal('done'),
    response_id: z.string(),
});

export const OrganizeErrorEventSchema = z.object({
    type: z.literal('error'),
    message: z.string(),
});

// ── Request Schemas ──────────────────────────────────────────────────────────

export const OrganizeChatRequestSchema = z.object({
    message: z.string().min(1).max(2000),
    response_id: z.string().optional(),
});

export type OrganizeChatRequest = z.infer<typeof OrganizeChatRequestSchema>;

export const OrganizeExecuteRequestSchema = z.object({
    operations: z.array(OrganizeOperationSchema).min(1),
});

export type OrganizeExecuteRequest = z.infer<typeof OrganizeExecuteRequestSchema>;

export const OrganizeExecuteResponseSchema = z.object({
    moved_count: z.number(),
    folders_created: z.number(),
});

export type OrganizeExecuteResponse = z.infer<typeof OrganizeExecuteResponseSchema>;

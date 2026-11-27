import { z } from 'zod';
import { UuidSchema } from './common.js';
import { JobSchema } from './jobs.js';

/**
 * How urgently the server processes a document: every job of a `background` one (a phone's photo backup) waits behind
 * the jobs of every `normal` one.
 */
export const ProcessingLaneSchema = z.enum(['normal', 'background']);

export type ProcessingLane = z.infer<typeof ProcessingLaneSchema>;

export const UploadRequestSchema = z.object({
    folder_id: UuidSchema.optional(),
    /** Left out, or any other value: `normal`. */
    lane: ProcessingLaneSchema.optional(),
});

export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export const UploadedDocumentSchema = z.object({
    id: UuidSchema,
    original_filename: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    folder_id: UuidSchema.nullable(),
    file_path: z.string(),
    created_at: z.string().datetime(),
});

export type UploadedDocument = z.infer<typeof UploadedDocumentSchema>;

export const UploadResponseSchema = z.object({
    session_id: z.string(),
    documents: z.array(UploadedDocumentSchema),
    jobs: z.array(JobSchema),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;

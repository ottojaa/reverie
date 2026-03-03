import { z } from 'zod';
import { DateOnlySchema, PaginatedResponseSchema, PaginationQuerySchema, UuidSchema } from './common.js';
import { JobStatusEnum } from './jobs.js';

/**
 * Document categories - distinguishes between content types
 */
export const DocumentCategoryEnum = z.enum([
    // Non-text content (photos, graphics, video)
    'photo', // Personal photos, images without text
    'screenshot', // Screen captures (may have some text but treated differently)
    'graphic', // Artwork, diagrams, illustrations
    'video', // Video files (mp4, mov, webm, etc.)

    // Common document types
    'receipt', // Purchase receipts, invoices
    'invoice', // Bills, invoices
    'letter', // Correspondence, emails
    'contract', // Legal agreements, contracts
    'form', // Filled forms, applications
    'certificate', // Certificates, licenses
    'report', // Reports, analyses
    'article', // News articles, blog posts
    'memo', // Internal memos, notes
    'newsletter', // Newsletters, publications

    // Financial documents
    'stock_statement', // Stock/investment statements
    'bank_statement', // Bank statements
    'medical_record', // Medical records
    'bill_of_materials', // Bill of materials

    'other', // Uncategorized documents with text
]);

export type DocumentCategory = z.infer<typeof DocumentCategoryEnum>;

export const ThumbnailPathsSchema = z.object({
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
});

export type ThumbnailPaths = z.infer<typeof ThumbnailPathsSchema>;

export const ThumbnailUrlsSchema = z.object({
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
});

export type ThumbnailUrls = z.infer<typeof ThumbnailUrlsSchema>;

export const EntitySchema = z.object({
    type: z.enum(['person', 'organization', 'location', 'product', 'account', 'identifier', 'other']),
    canonical_name: z.string(),
    raw_text: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
});

export type Entity = z.infer<typeof EntitySchema>;

export const DocumentSchema = z.object({
    id: UuidSchema,
    folder_id: UuidSchema.nullable(),
    file_path: z.string(),
    file_hash: z.string(),
    original_filename: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    thumbnail_blurhash: z.string().nullable(),
    thumbnail_paths: ThumbnailPathsSchema.nullable(),
    document_category: DocumentCategoryEnum.nullable(),
    extracted_date: DateOnlySchema.nullable(),
    ocr_status: JobStatusEnum,
    thumbnail_status: JobStatusEnum,
    llm_status: JobStatusEnum,
    llm_summary: z.string().nullable(),
    llm_metadata: z.record(z.unknown()).nullable(),
    llm_processed_at: z.string().datetime().nullable(),
    llm_token_count: z.number().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    // Signed URLs for secure file access
    file_url: z.string().nullable(),
    thumbnail_urls: ThumbnailUrlsSchema.nullable(),
});

export type Document = z.infer<typeof DocumentSchema>;

export const DocumentListResponseSchema = PaginatedResponseSchema(DocumentSchema);

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

export const DocumentListQuerySchema = PaginationQuerySchema.extend({
    folder_id: UuidSchema.optional(),
    category: DocumentCategoryEnum.optional(),
    date_from: DateOnlySchema.optional(),
    date_to: DateOnlySchema.optional(),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const DocumentStatusResponseSchema = z.object({
    document_id: UuidSchema,
    ocr_status: JobStatusEnum,
    thumbnail_status: JobStatusEnum,
    llm_status: JobStatusEnum,
    jobs: z.array(
        z.object({
            type: z.string(),
            status: JobStatusEnum,
            progress: z.number().optional(),
            completed_at: z.string().datetime().optional(),
        }),
    ),
});

export type DocumentStatusResponse = z.infer<typeof DocumentStatusResponseSchema>;

export const BatchDeleteDocumentsSchema = z.object({
    ids: z.array(UuidSchema).min(1).max(100),
});

export type BatchDeleteDocuments = z.infer<typeof BatchDeleteDocumentsSchema>;

export const ConflictStrategyEnum = z.enum(['replace', 'keep_both']);
export type ConflictStrategy = z.infer<typeof ConflictStrategyEnum>;

export const CheckDuplicatesRequestSchema = z.object({
    folder_id: UuidSchema,
    filenames: z.array(z.string().min(1)).min(1),
});
export type CheckDuplicatesRequest = z.infer<typeof CheckDuplicatesRequestSchema>;

export const CheckDuplicatesResponseSchema = z.object({
    duplicates: z.array(z.string()),
});
export type CheckDuplicatesResponse = z.infer<typeof CheckDuplicatesResponseSchema>;

export const MoveDocumentsRequestSchema = z.object({
    document_ids: z.array(UuidSchema).min(1).max(100),
    folder_id: UuidSchema,
    conflict_strategy: ConflictStrategyEnum.optional(),
});
export type MoveDocumentsRequest = z.infer<typeof MoveDocumentsRequestSchema>;

export const UpdateDocumentRequestSchema = z.object({
    original_filename: z.string().min(1).max(255),
});
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;

export const DocumentOcrResultSchema = z.object({
    document_id: UuidSchema,
    raw_text: z.string(),
    confidence_score: z.number().nullable(),
    text_density: z.number().nullable(),
    has_meaningful_text: z.boolean(),
    metadata: z.record(z.unknown()).nullable(),
    processed_at: z.string().datetime(),
});

export type DocumentOcrResult = z.infer<typeof DocumentOcrResultSchema>;

export const TrimVideoRequestSchema = z
    .object({
        start: z.number().min(0),
        end: z.number().min(0),
        saveAsCopy: z.boolean(),
        sessionId: z.string().uuid().optional(),
    })
    .refine((data) => data.start < data.end, { message: 'start must be less than end', path: ['end'] });

export type TrimVideoRequest = z.infer<typeof TrimVideoRequestSchema>;

export const TrimVideoResponseSchema = z.object({
    jobId: UuidSchema,
});

export type TrimVideoResponse = z.infer<typeof TrimVideoResponseSchema>;

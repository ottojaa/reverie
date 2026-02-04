import { z } from 'zod';
import { DateOnlySchema, PaginationQuerySchema, UuidSchema } from './common.js';
import { JobStatusEnum } from './jobs.js';

/**
 * Document categories - distinguishes between content types
 */
export const DocumentCategoryEnum = z.enum([
    // Non-text content (photos, graphics)
    'photo', // Personal photos, images without text
    'screenshot', // Screen captures (may have some text but treated differently)
    'graphic', // Artwork, diagrams, illustrations

    // Common document types
    'receipt', // Purchase receipts, invoices
    'invoice', // Bills, invoices
    'statement', // Bank statements, account statements
    'letter', // Correspondence, emails
    'contract', // Legal agreements, contracts
    'form', // Filled forms, applications
    'certificate', // Certificates, licenses
    'report', // Reports, analyses
    'article', // News articles, blog posts
    'memo', // Internal memos, notes
    'newsletter', // Newsletters, publications

    // Financial documents (common use case)
    'stock_statement', // Stock/investment statements
    'dividend_notice', // Dividend notifications
    'tax_document', // Tax forms, returns

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

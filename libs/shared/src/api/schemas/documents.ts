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

/** Categories for visual/media content that carries no meaningful text. */
export const NON_TEXT_CATEGORIES = ['photo', 'screenshot', 'graphic', 'video'] as const satisfies readonly DocumentCategory[];

/** Text-bearing document categories — everything in DocumentCategoryEnum that isn't visual/media. */
export const TEXT_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = DocumentCategoryEnum.options.filter(
    (category) => !(NON_TEXT_CATEGORIES as readonly string[]).includes(category),
);

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
    type: z.enum(['person', 'organization', 'location', 'product', 'account', 'identifier', 'contact', 'other']),
    canonical_name: z.string(),
    raw_text: z.string(),
    // Optional: the LLM extraction contract no longer requests confidence, and older
    // stored metadata predates it. Kept optional so both old and new entities validate.
    confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

// EXIF-derived photo metadata (GPS location + capture time), populated at upload
// time for photos that carry GPS EXIF data.
export const DocumentPhotoMetadataSchema = z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    taken_at: z.string().nullable(),
});

export type DocumentPhotoMetadata = z.infer<typeof DocumentPhotoMetadataSchema>;

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
    // Video length in seconds; null for non-video documents (and videos not yet reprocessed).
    duration_seconds: z.number().nullable(),
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
    // Read-only: true when the document's folder or collection is private. Documents have no
    // privacy setting of their own; they are private exactly when their folder is. A document
    // is only ever returned while its folder's lock is open.
    is_private: z.boolean(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    // Signed URLs for secure file access
    file_url: z.string().nullable(),
    thumbnail_urls: ThumbnailUrlsSchema.nullable(),
    // Only populated on the document detail endpoint (GET /documents/:id);
    // omitted from list responses to avoid per-row joins.
    photo_metadata: DocumentPhotoMetadataSchema.nullable().optional(),
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

/** Most files one `POST /documents/check-content` call accepts; clients with more send several calls. */
export const CHECK_CONTENT_MAX_FILES = 500;

/** A SHA-256 as 64 hex characters, normalised to lower case (what `documents.file_hash` stores). */
export const Sha256HexSchema = z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .transform((hash) => hash.toLowerCase());

export const CheckContentRequestSchema = z.object({
    /** Folder the files are about to go into. Without it only the content is checked. */
    folder_id: UuidSchema.optional(),
    files: z
        .array(
            z.object({
                name: z.string().min(1),
                /** Left out when the client could not read the file: it then gets the name check only. */
                sha256: Sha256HexSchema.optional(),
            }),
        )
        .min(1)
        .max(CHECK_CONTENT_MAX_FILES),
});
export type CheckContentRequest = z.input<typeof CheckContentRequestSchema>;

/**
 * Where the same content already is. A match inside a private folder or collection (unlocked or not)
 * is only ever `private`, with no id, name or path; a match that is only in the trash is `trash`.
 */
export const ContentLocationSchema = z.discriminatedUnion('where', [
    z.object({
        where: z.literal('folder'),
        /** Names from the collection down (`['Work', 'Invoices']`), current names; null for a document at the root. A list, not a joined string, because a folder name may contain `/`. */
        folder_path: z.array(z.string()).nullable(),
        filename: z.string(),
    }),
    z.object({ where: z.literal('private') }),
    z.object({ where: z.literal('trash') }),
]);
export type ContentLocation = z.infer<typeof ContentLocationSchema>;

export const CheckContentResultSchema = z.object({
    name: z.string(),
    sha256: z.string().nullable(),
    /** Null when the content is nowhere in the library (or no hash was sent). */
    content: ContentLocationSchema.nullable(),
    /** A document with this filename is already in the target folder, whatever its content. */
    name_conflict: z.boolean(),
});
export type CheckContentResult = z.infer<typeof CheckContentResultSchema>;

export const CheckContentResponseSchema = z.object({
    /** One entry per requested file, in request order. */
    results: z.array(CheckContentResultSchema),
});
export type CheckContentResponse = z.infer<typeof CheckContentResponseSchema>;

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

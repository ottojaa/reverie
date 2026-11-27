import { z } from 'zod';
import { DateOnlySchema, PaginatedResponseSchema, PaginationQuerySchema, QueryFlagSchema, UuidSchema } from './common.js';
import { JobStatusEnum } from './jobs.js';

/** Where a document's tag came from. `taught` tags come from a taught label and carry its id. */
export const DocumentTagSourceEnum = z.enum(['user', 'auto', 'taught']);
export type DocumentTagSource = z.infer<typeof DocumentTagSourceEnum>;

export const DocumentTagSchema = z.object({
    name: z.string(),
    source: DocumentTagSourceEnum,
    /** The taught label behind a `taught` tag; null for the other sources. */
    label_id: UuidSchema.nullable(),
});
export type DocumentTag = z.infer<typeof DocumentTagSchema>;

/**
 * The file-type kind a document belongs to, by MIME type alone (see documentKindOf). Named `image`, not
 * `photo`, to stay apart from the AI document_category value `photo`.
 */
export const DocumentKindSchema = z.enum(['image', 'video', 'file']);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

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

// EXIF-derived photo metadata (GPS location, capture time, camera and exposure). A video's GPS and
// capture date are kept in the same shape. The camera and exposure fields are optional so a client
// built before they existed still parses a response without them.
export const DocumentPhotoMetadataSchema = z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    // The clock reading as if it were UTC; the instant is this minus `taken_at_offset` when that is known.
    taken_at: z.string().nullable(),
    // The UTC offset the capture clock was in ('+02:00'), when the file says so.
    taken_at_offset: z.string().nullable().optional(),
    camera_make: z.string().nullable().optional(),
    camera_model: z.string().nullable().optional(),
    lens_model: z.string().nullable().optional(),
    iso: z.number().nullable().optional(),
    f_number: z.number().nullable().optional(),
    // Seconds.
    exposure_time: z.number().nullable().optional(),
    // Millimetres.
    focal_length: z.number().nullable().optional(),
    focal_length_35mm: z.number().nullable().optional(),
    flash_fired: z.boolean().nullable().optional(),
    // EXIF orientation, 1-8.
    orientation: z.number().nullable().optional(),
    // The image size as shot.
    pixel_width: z.number().nullable().optional(),
    pixel_height: z.number().nullable().optional(),
});

export type DocumentPhotoMetadata = z.infer<typeof DocumentPhotoMetadataSchema>;

// A video's technical facts, from ffprobe. Detail-only, like photo_metadata.
export const DocumentVideoMetadataSchema = z.object({
    container: z.string().nullable(),
    video_codec: z.string().nullable(),
    video_profile: z.string().nullable(),
    audio_codec: z.string().nullable(),
    // Whole-file bits per second.
    bitrate: z.number().nullable(),
    // The coded size; apply `rotation` for the size a player shows.
    width: z.number().nullable(),
    height: z.number().nullable(),
    frame_rate: z.number().nullable(),
    // Degrees clockwise a player turns the picture: 0, 90, 180 or 270.
    rotation: z.number().nullable(),
    color_transfer: z.string().nullable(),
    is_hdr: z.boolean(),
    creation_time: z.string().nullable(),
});

export type DocumentVideoMetadata = z.infer<typeof DocumentVideoMetadataSchema>;

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
    // Read-only: true when the document is anywhere beneath a private folder. Documents have no
    // privacy setting of their own; they are private exactly when their folder is. A document
    // is only ever returned while its folder's lock is open.
    is_private: z.boolean(),
    // When the photo or video was taken, a local clock reading stored as if it were UTC (2026-11-23T14:03:00.000Z
    // means 14:03 on the wall clock where it was taken): group it by its own date, never shift it to a time zone.
    // Null for anything without a capture time; absent from responses of servers that predate it.
    taken_at: z.string().nullable().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    // Signed URLs for secure file access
    file_url: z.string().nullable(),
    // Signed master playlist of the video's HLS renditions (same lifetime and rules as file_url); null for
    // anything that is not a video and for a video whose renditions are not all encoded yet: play file_url.
    hls_url: z.string().nullable(),
    thumbnail_urls: ThumbnailUrlsSchema.nullable(),
    // Where a photo or video was taken, so a list row can name the place; sent by GET /documents and the
    // detail endpoint.
    city: z.string().nullable().optional(),
    // Only populated on the document detail endpoint (GET /documents/:id);
    // omitted from list responses to avoid per-row joins.
    photo_metadata: DocumentPhotoMetadataSchema.nullable().optional(),
    // Detail-only as well; null for a video not probed yet and for anything that is not a video.
    video_metadata: DocumentVideoMetadataSchema.nullable().optional(),
    // Detail-only too: the document's tags with where each came from.
    tags: z.array(DocumentTagSchema).optional(),
});

export type Document = z.infer<typeof DocumentSchema>;

export const DocumentListResponseSchema = PaginatedResponseSchema(DocumentSchema);

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

export const DocumentSortSchema = z.enum(['name', 'size']);

export type DocumentSort = z.infer<typeof DocumentSortSchema>;

export const DocumentListQuerySchema = PaginationQuerySchema.extend({
    folder_id: UuidSchema.optional(),
    /** true: only the documents in no folder. Cannot be combined with `folder_id`. */
    top_level: QueryFlagSchema.optional(),
    /**
     * true, with `kind`: the order for a few sample cards, screenshots and screen recordings after everything
     * else, then the kind's usual order.
     */
    preview: QueryFlagSchema.optional(),
    category: DocumentCategoryEnum.optional(),
    date_from: DateOnlySchema.optional(),
    date_to: DateOnlySchema.optional(),
    /**
     * Only documents of this kind (by MIME type, see documentKindOf); `total` is that kind's total. `image` and
     * `video` come back by date taken (upload date when there is none), the others by upload date.
     */
    kind: DocumentKindSchema.optional(),
    /** true: only photos and videos (both kinds together), by date taken like `kind=image`. Not with `kind`. */
    media: QueryFlagSchema.optional(),
    /**
     * true: only documents whose text recognition, thumbnail or AI summary is still pending or running
     * (transcoding runs on its own clock and is left out). `total` is then the processing total.
     */
    processing: QueryFlagSchema.optional(),
    /**
     * `name`: by filename, A to Z, folding the letters A-Z only and comparing by code point, equal names by id.
     * `size`: largest first, equal sizes by id descending. Omitted: by date, as `kind` and `media` describe.
     */
    sort: DocumentSortSchema.optional(),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const DocumentSummaryQuerySchema = z.object({
    /** Omitted (and no `top_level`): the whole library, with the same private-folder and trash rules as the list. */
    folder_id: UuidSchema.optional(),
    /** true: only the documents in no folder. Cannot be combined with `folder_id`. */
    top_level: QueryFlagSchema.optional(),
});

export type DocumentSummaryQuery = z.infer<typeof DocumentSummaryQuerySchema>;

const KindTotalsSchema = z.object({
    count: z.number().int().nonnegative(),
    bytes: z.number().nonnegative(),
});

/** One file type of the Files kind, as its lowercase filename extension; names without one count toward no type. */
export const DocumentTopTypeSchema = z.object({
    ext: z.string(),
    count: z.number().int().positive(),
});

/** What a scope holds, per kind (see documentKindOf): the figures behind the Browse dashboard's cards. */
export const DocumentSummaryResponseSchema = z.object({
    image: KindTotalsSchema,
    video: KindTotalsSchema,
    file: KindTotalsSchema.extend({
        /** The most common file types, most common first; at most four. */
        top_types: z.array(DocumentTopTypeSchema).max(4),
    }),
    /**
     * The first and last day a folder's photos and videos were taken (upload time where there is no date taken), on
     * `GET /documents/summary?folder_id=` only; null when it holds none, and for any wider scope.
     */
    media_dates: z.object({ first: z.string().datetime(), last: z.string().datetime() }).nullable().optional(),
});

export type DocumentSummaryResponse = z.infer<typeof DocumentSummaryResponseSchema>;

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

/** Exactly one of `folder_id` and `top_level` says where the files are about to go. */
export const CheckDuplicatesRequestSchema = z
    .object({
        folder_id: UuidSchema.optional(),
        top_level: z.boolean().optional(),
        filenames: z.array(z.string().min(1)).min(1),
    })
    .refine((value) => (value.folder_id !== undefined) !== (value.top_level === true), { message: 'Give either folder_id or top_level' });
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

export const CheckContentRequestSchema = z
    .object({
        /** Folder the files are about to go into. Without it or `top_level` only the content is checked. */
        folder_id: UuidSchema.optional(),
        /** true: the files are about to go to the top level (in no folder). */
        top_level: z.boolean().optional(),
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
    })
    .refine((value) => value.folder_id === undefined || value.top_level !== true, { message: 'Give folder_id or top_level, not both' });
export type CheckContentRequest = z.input<typeof CheckContentRequestSchema>;

/**
 * Where the same content already is. A match anywhere beneath a private folder (unlocked or not)
 * is only ever `private`, with no id, name or path; a match that is only in the trash is `trash`.
 */
export const ContentLocationSchema = z.discriminatedUnion('where', [
    z.object({
        where: z.literal('folder'),
        /** Folder names from the top level down (`['Work', '2024', 'Invoices']`), current names; null for a document in no folder. */
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
    /** null: to the top level (in no folder). Required, so a request that lost its destination moves nothing. */
    folder_id: UuidSchema.nullable(),
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

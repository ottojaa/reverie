import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { LlmMetadata } from '../llm/types';

// Enums
export type JobStatus = 'pending' | 'processing' | 'complete' | 'failed' | 'skipped';
export type JobType = 'ocr' | 'thumbnail' | 'llm_summary' | 'video_trim' | 'transcode';
export type TargetType = 'document' | 'folder';
/** `taught`: put there by a label taught by example (see taught-labels/). */
export type TagSource = 'user' | 'auto' | 'taught';

// Users table
export type UserRole = 'admin' | 'user';

export interface UsersTable {
    id: Generated<string>;
    email: string;
    password_hash: string | null;
    google_id: string | null;
    display_name: string;
    storage_quota_bytes: number;
    storage_used_bytes: ColumnType<number, number | undefined, number>;
    storage_path: string;
    is_active: ColumnType<boolean, boolean | undefined, boolean>;
    role: ColumnType<UserRole, UserRole | undefined, UserRole>;
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
    last_login_at: Date | null;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

// Folders table
export type FolderType = 'collection' | 'folder';

export interface FoldersTable {
    id: Generated<string>;
    user_id: string;
    parent_id: string | null;
    name: string;
    path: string;
    description: string | null;
    emoji: string | null;
    sort_order: number;
    type: FolderType;
    is_private: ColumnType<boolean, boolean | undefined, boolean>;
    /** When the folder went to the trash; null while live. */
    deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type Folder = Selectable<FoldersTable>;
export type NewFolder = Insertable<FoldersTable>;
export type FolderUpdate = Updateable<FoldersTable>;

// Documents table
export interface DocumentsTable {
    id: Generated<string>;
    user_id: string;
    folder_id: string | null;
    file_path: string;
    file_hash: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    duration_seconds: number | null;
    thumbnail_blurhash: string | null;
    thumbnail_paths: ThumbnailPaths | null;
    document_category: string | null;
    extracted_date: Date | null;
    ocr_status: JobStatus;
    thumbnail_status: JobStatus;
    llm_status: JobStatus;
    /** The HLS ladder's state. 'skipped' for anything that is not a video; videos start 'pending'. */
    transcode_status: ColumnType<JobStatus, JobStatus | undefined, JobStatus>;
    has_meaningful_text: ColumnType<boolean, boolean | undefined, boolean>; // Added in Plan 05
    /** When the OCR worker finished storing the text flag and EXIF; null while it runs, and for images that predate the column. */
    ocr_facts_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    /** When the camera EXIF (make, model, lens, GPS) was read from the stored file into photo_metadata; null until it was. */
    camera_read_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    /** When the full EXIF (images) or the ffprobe facts (videos) were read from the stored file into photo_metadata / video_metadata; null until they were. */
    media_read_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    search_vector: unknown | null; // tsvector type — unified search index
    /** When the document went to the trash; null while live. */
    deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ThumbnailPaths {
    sm: string;
    md: string;
    lg: string;
}

export type Document = Selectable<DocumentsTable>;
export type NewDocument = Insertable<DocumentsTable>;
export type DocumentUpdate = Updateable<DocumentsTable>;

// OCR Results table
export interface OcrResultsTable {
    id: Generated<string>;
    document_id: string;
    raw_text: string;
    confidence_score: number | null;
    text_density: number | null; // chars per 1000px²
    has_meaningful_text: ColumnType<boolean, boolean | undefined, boolean>;
    metadata: OcrMetadata | null;
    text_vector: unknown | null; // tsvector type
    processed_at: ColumnType<Date, Date | undefined, never>;
    ocr_engine: ColumnType<string, string | undefined, string>;
    duration_ms: number | null;
}

export interface OcrMetadata {
    companies?: string[];
    dates?: string[];
    values?: Array<{ amount: number; currency: string }>;
    [key: string]: unknown;
}

export type OcrResult = Selectable<OcrResultsTable>;
export type NewOcrResult = Insertable<OcrResultsTable>;
export type OcrResultUpdate = Updateable<OcrResultsTable>;

// LLM Results table
export interface LlmResultsTable {
    id: Generated<string>;
    document_id: string;
    summary: string | null;
    metadata: LlmMetadata | null;
    token_count: number | null;
    processing_type: string | null;
    duration_ms: number | null;
    processed_at: ColumnType<Date, Date | undefined, never>;
}

export type LlmResult = Selectable<LlmResultsTable>;
export type NewLlmResult = Insertable<LlmResultsTable>;
export type LlmResultUpdate = Updateable<LlmResultsTable>;

// Processing Jobs table
export interface ProcessingJobsTable {
    id: Generated<string>;
    user_id: string;
    job_type: JobType;
    target_type: TargetType;
    target_id: string;
    status: JobStatus;
    priority: ColumnType<number, number | undefined, number>;
    attempts: ColumnType<number, number | undefined, number>;
    error_message: string | null;
    result: Record<string, unknown> | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    started_at: Date | null;
    completed_at: Date | null;
    duration_ms: number | null;
}

export type ProcessingJob = Selectable<ProcessingJobsTable>;
export type NewProcessingJob = Insertable<ProcessingJobsTable>;
export type ProcessingJobUpdate = Updateable<ProcessingJobsTable>;

// Document Tags table
export interface DocumentTagsTable {
    id: Generated<string>;
    document_id: string;
    tag: string;
    source: TagSource;
    created_at: ColumnType<Date, Date | undefined, never>;
}

export type DocumentTag = Selectable<DocumentTagsTable>;
export type NewDocumentTag = Insertable<DocumentTagsTable>;
export type DocumentTagUpdate = Updateable<DocumentTagsTable>;

// Labels taught by example
export interface TaughtLabelsTable {
    id: Generated<string>;
    user_id: string;
    /** The tag text the label puts on images. */
    name: string;
    /** Cosine similarity to the nearest example an image must reach. */
    threshold: number;
    threshold_is_custom: Generated<boolean>;
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type TaughtLabel = Selectable<TaughtLabelsTable>;

/** Shared shape of the two label/document link tables. */
export interface TaughtLabelLinkTable {
    label_id: string;
    document_id: string;
    created_at: ColumnType<Date, Date | undefined, never>;
}

// Near-duplicate detection (migration 023)
export interface DuplicateEdgesTable {
    /** The pair is stored once with doc_a < doc_b. */
    doc_a: string;
    doc_b: string;
    /** Cosine similarity of the two image embeddings. */
    similarity: number;
}

export interface DocumentDuplicateScansTable {
    document_id: string;
    /** The similarity threshold the scan used: pairs below it were not stored. */
    threshold: number;
    scanned_at: ColumnType<Date, Date | undefined, Date>;
}

export interface DuplicateDismissalsTable {
    user_id: string;
    doc_a: string;
    doc_b: string;
    created_at: ColumnType<Date, Date | undefined, never>;
}

// Photo Metadata table
export interface PhotoMetadataTable {
    id: Generated<string>;
    document_id: string;
    latitude: number | null;
    longitude: number | null;
    country: string | null;
    city: string | null;
    /** The clock reading as if it were UTC; the instant is taken_at minus taken_at_offset when the offset is known. Photos and videos alike. */
    taken_at: Date | null;
    /** The UTC offset the capture clock was in ('+02:00'), when the file says so. */
    taken_at_offset: string | null;
    camera_make: string | null;
    camera_model: string | null;
    lens_model: string | null;
    iso: number | null;
    f_number: number | null;
    /** Seconds. */
    exposure_time: number | null;
    /** Millimetres. */
    focal_length: number | null;
    focal_length_35mm: number | null;
    flash_fired: boolean | null;
    /** EXIF orientation, 1-8. */
    orientation: number | null;
    /** The image size as shot, from EXIF. */
    pixel_width: number | null;
    pixel_height: number | null;
    processed_at: ColumnType<Date, Date | undefined, never>;
}

/** A finished set of HLS renditions, keyed by the content hash of the original (see migration 024). */
export interface TranscodeSetsTable {
    file_hash: string;
    /** Every stored file's storage path, `master.m3u8` included. */
    files: ColumnType<string[], string, string>;
    rungs: ColumnType<TranscodeRungRecord[], string, string>;
    encoder: string;
    tone_map: string | null;
    total_bytes: ColumnType<string | number, number, number>;
    created_at: ColumnType<Date, Date | undefined, never>;
}

export interface TranscodeRungRecord {
    width: number;
    height: number;
    bytes: number;
}

// Video Metadata table: one row per video, from ffprobe. A video's GPS and capture date live in photo_metadata.
export interface VideoMetadataTable {
    document_id: string;
    container: string | null;
    video_codec: string | null;
    video_profile: string | null;
    pixel_format: string | null;
    audio_codec: string | null;
    /** Whole-file bits per second. */
    bitrate: number | null;
    /** The coded size; a player applies `rotation` to get the displayed size. */
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    /** Degrees clockwise a player must turn the picture: 0, 90, 180 or 270. */
    rotation: number | null;
    color_transfer: string | null;
    color_primaries: string | null;
    color_space: string | null;
    is_hdr: ColumnType<boolean, boolean | undefined, boolean>;
    /** The container's creation time (a UTC instant). */
    creation_time: Date | null;
    processed_at: ColumnType<Date, Date | undefined, Date>;
}

export type VideoMetadata = Selectable<VideoMetadataTable>;

export type PhotoMetadata = Selectable<PhotoMetadataTable>;
export type NewPhotoMetadata = Insertable<PhotoMetadataTable>;
export type PhotoMetadataUpdate = Updateable<PhotoMetadataTable>;
// Refresh Tokens table (for rotation - one-time use)
export interface RefreshTokensTable {
    id: Generated<string>;
    user_id: string;
    token_hash: string;
    expires_at: Date;
    created_at: ColumnType<Date, Date | undefined, never>;
}

export type RefreshToken = Selectable<RefreshTokensTable>;
export type NewRefreshToken = Insertable<RefreshTokensTable>;

// Server settings table (admin-editable overrides of the defaults in settings/registry.ts)
export interface ServerSettingsTable {
    key: string;
    // Stored as jsonb: written as a JSON string, read back already parsed.
    value: ColumnType<unknown, string, string>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
    updated_by: string | null;
}

export type ServerSetting = Selectable<ServerSettingsTable>;

// Audit log of library tool writes (see tools/audit.ts). state_before/state_after are jsonb snapshots; they are
// written as JSON strings and read back already parsed.
export interface ToolAuditLogTable {
    id: Generated<string>;
    user_id: string;
    tool: string;
    input: ColumnType<unknown, string, string>;
    state_before: ColumnType<unknown, string, string>;
    state_after: ColumnType<unknown, string, string>;
    created_at: ColumnType<Date, Date | undefined, never>;
    undone_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export type ToolAuditLogEntry = Selectable<ToolAuditLogTable>;

// API tokens (hash only; the secret is shown once at creation)
export type ApiTokenKind = 'personal' | 'agent';

export interface ApiTokensTable {
    id: Generated<string>;
    user_id: string;
    name: string;
    token_hash: string;
    token_prefix: string;
    kind: ColumnType<ApiTokenKind, ApiTokenKind | undefined, never>;
    /** Null for a token that never expires (personal tokens). */
    expires_at: Date | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    last_used_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    revoked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export type ApiToken = Selectable<ApiTokensTable>;

// In-app agent chats
export interface AgentChatsTable {
    id: Generated<string>;
    user_id: string;
    title: string;
    claude_session_id: string | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface AgentMessagesTable {
    id: Generated<string>;
    chat_id: string;
    role: 'user' | 'assistant';
    /** AgentItem[]; serialised JSON on write. */
    items: ColumnType<unknown, string, string>;
    error: string | null;
    created_at: ColumnType<Date, Date | undefined, never>;
}

export type AgentChatRow = Selectable<AgentChatsTable>;
export type AgentMessageRow = Selectable<AgentMessagesTable>;

// Embeddings (pgvector). `embedding` is pgvector's text form, '[0.1,0.2,...]'; use toVectorLiteral to write it.
export interface DocumentTextEmbeddingsTable {
    id: Generated<string>;
    document_id: string;
    chunk_index: number;
    /** The chunk's character range within the embedded text (summary, blank line, OCR text). */
    char_start: number;
    char_end: number;
    /** md5 of the whole embedded text, the same on every chunk of a document. */
    content_hash: string;
    model: string;
    model_version: string;
    embedding: string;
    created_at: ColumnType<Date, Date | undefined, never>;
}

export interface DocumentImageEmbeddingsTable {
    document_id: string;
    /** md5 of the thumbnail rendition that was embedded. */
    content_hash: string;
    model: string;
    model_version: string;
    embedding: string;
    created_at: ColumnType<Date, Date | undefined, never>;
}

export interface ImageKindSeedSetsTable {
    version: string;
    /** The image model the seeds' embeddings come from. */
    model: string;
    model_version: string;
    /** Frozen statistics that scale similarities and prompt scores (see image-kind/seed-set.ts). */
    stats: ColumnType<Record<string, unknown>, string, string>;
    created_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

export interface ImageKindSeedsTable {
    version: string;
    document_id: string;
    kind: string;
}

export interface DocumentImageKindsTable {
    document_id: string;
    kind: string;
    /** Per-kind score after priors, e.g. {"photo": 0.21, "screenshot": 0.18}. */
    scores: ColumnType<Record<string, number>, string, string>;
    /** What the verdict was based on: camera facts present, screen-like size, the margin and the runner-up. */
    signals: ColumnType<Record<string, unknown>, string, string>;
    /** The classifier version (prompts and thresholds) that produced the verdict. */
    prompt_version: string;
    /** The image model of the embedding that was scored. */
    model: string;
    model_version: string;
    classified_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

// Database interface
export interface Database {
    users: UsersTable;
    refresh_tokens: RefreshTokensTable;
    folders: FoldersTable;
    documents: DocumentsTable;
    ocr_results: OcrResultsTable;
    llm_results: LlmResultsTable;
    processing_jobs: ProcessingJobsTable;
    document_tags: DocumentTagsTable;
    photo_metadata: PhotoMetadataTable;
    video_metadata: VideoMetadataTable;
    transcode_sets: TranscodeSetsTable;
    server_settings: ServerSettingsTable;
    tool_audit_log: ToolAuditLogTable;
    api_tokens: ApiTokensTable;
    agent_chats: AgentChatsTable;
    agent_messages: AgentMessagesTable;
    document_text_embeddings: DocumentTextEmbeddingsTable;
    document_image_embeddings: DocumentImageEmbeddingsTable;
    document_image_kinds: DocumentImageKindsTable;
    image_kind_seed_sets: ImageKindSeedSetsTable;
    image_kind_seeds: ImageKindSeedsTable;
    taught_labels: TaughtLabelsTable;
    taught_label_examples: TaughtLabelLinkTable;
    taught_label_exclusions: TaughtLabelLinkTable;
    duplicate_edges: DuplicateEdgesTable;
    document_duplicate_scans: DocumentDuplicateScansTable;
    duplicate_dismissals: DuplicateDismissalsTable;
}

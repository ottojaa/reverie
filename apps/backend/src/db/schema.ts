import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { LlmMetadata } from '../llm/types';

// Enums
export type JobStatus = 'pending' | 'processing' | 'complete' | 'failed' | 'skipped';
export type JobType = 'ocr' | 'thumbnail' | 'llm_summary';
export type TargetType = 'document' | 'folder';
export type TagSource = 'user' | 'auto';

// Users table
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
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
    last_login_at: Date | null;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

// Folders table
export type FolderType = 'category' | 'section';

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
    thumbnail_blurhash: string | null;
    thumbnail_paths: ThumbnailPaths | null;
    document_category: string | null;
    extracted_date: Date | null;
    ocr_status: JobStatus;
    thumbnail_status: JobStatus;
    llm_status: JobStatus;
    has_meaningful_text: ColumnType<boolean, boolean | undefined, boolean>; // Added in Plan 05
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
    text_density: number | null; // Added in Plan 05: chars per 1000px²
    has_meaningful_text: ColumnType<boolean, boolean | undefined, boolean>; // Added in Plan 05
    metadata: OcrMetadata | null;
    text_vector: unknown | null; // tsvector type
    processed_at: ColumnType<Date, Date | undefined, never>;
    /** OCR engine identifier, e.g. "paddleocr/PP-OCRv4" or "tesseract/5.x-fin+eng" */
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

// Photo Metadata table
export interface PhotoMetadataTable {
    id: Generated<string>;
    document_id: string;
    latitude: number | null;
    longitude: number | null;
    country: string | null;
    city: string | null;
    taken_at: Date | null;
    processed_at: ColumnType<Date, Date | undefined, never>;
}

export type PhotoMetadata = Selectable<PhotoMetadataTable>;
export type NewPhotoMetadata = Insertable<PhotoMetadataTable>;
export type PhotoMetadataUpdate = Updateable<PhotoMetadataTable>;

// Database interface
export interface Database {
    users: UsersTable;
    folders: FoldersTable;
    documents: DocumentsTable;
    ocr_results: OcrResultsTable;
    llm_results: LlmResultsTable;
    processing_jobs: ProcessingJobsTable;
    document_tags: DocumentTagsTable;
    photo_metadata: PhotoMetadataTable;
}

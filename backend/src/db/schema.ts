import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

// Enums
export type JobStatus = 'pending' | 'processing' | 'complete' | 'failed'
export type JobType = 'ocr' | 'thumbnail' | 'llm_summary'
export type TargetType = 'document' | 'folder'
export type TagSource = 'user' | 'auto'

// Folders table
export interface FoldersTable {
  id: Generated<string>
  parent_id: string | null
  name: string
  path: string
  description: string | null
  created_at: ColumnType<Date, Date | undefined, never>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export type Folder = Selectable<FoldersTable>
export type NewFolder = Insertable<FoldersTable>
export type FolderUpdate = Updateable<FoldersTable>

// Documents table
export interface DocumentsTable {
  id: Generated<string>
  folder_id: string | null
  file_path: string
  file_hash: string
  original_filename: string
  mime_type: string
  size_bytes: number
  width: number | null
  height: number | null
  thumbnail_blurhash: string | null
  thumbnail_paths: ThumbnailPaths | null
  document_category: string | null
  extracted_date: Date | null
  ocr_status: JobStatus
  thumbnail_status: JobStatus
  llm_summary: string | null
  llm_metadata: Record<string, unknown> | null
  llm_processed_at: Date | null
  llm_token_count: number | null
  created_at: ColumnType<Date, Date | undefined, never>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface ThumbnailPaths {
  sm: string
  md: string
  lg: string
}

export type Document = Selectable<DocumentsTable>
export type NewDocument = Insertable<DocumentsTable>
export type DocumentUpdate = Updateable<DocumentsTable>

// OCR Results table
export interface OcrResultsTable {
  id: Generated<string>
  document_id: string
  raw_text: string
  confidence_score: number | null
  metadata: OcrMetadata | null
  text_vector: unknown | null // tsvector type
  processed_at: ColumnType<Date, Date | undefined, never>
}

export interface OcrMetadata {
  companies?: string[]
  dates?: string[]
  values?: Array<{ amount: number; currency: string }>
  [key: string]: unknown
}

export type OcrResult = Selectable<OcrResultsTable>
export type NewOcrResult = Insertable<OcrResultsTable>
export type OcrResultUpdate = Updateable<OcrResultsTable>

// Processing Jobs table
export interface ProcessingJobsTable {
  id: Generated<string>
  job_type: JobType
  target_type: TargetType
  target_id: string
  status: JobStatus
  priority: ColumnType<number, number | undefined, number>
  attempts: ColumnType<number, number | undefined, number>
  error_message: string | null
  result: Record<string, unknown> | null
  created_at: ColumnType<Date, Date | undefined, never>
  started_at: Date | null
  completed_at: Date | null
}

export type ProcessingJob = Selectable<ProcessingJobsTable>
export type NewProcessingJob = Insertable<ProcessingJobsTable>
export type ProcessingJobUpdate = Updateable<ProcessingJobsTable>

// Document Tags table
export interface DocumentTagsTable {
  id: Generated<string>
  document_id: string
  tag: string
  source: TagSource
  created_at: ColumnType<Date, Date | undefined, never>
}

export type DocumentTag = Selectable<DocumentTagsTable>
export type NewDocumentTag = Insertable<DocumentTagsTable>
export type DocumentTagUpdate = Updateable<DocumentTagsTable>

// Database interface
export interface Database {
  folders: FoldersTable
  documents: DocumentsTable
  ocr_results: OcrResultsTable
  processing_jobs: ProcessingJobsTable
  document_tags: DocumentTagsTable
}



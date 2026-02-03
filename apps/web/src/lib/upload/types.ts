import type { Job, UploadedDocument } from '@reverie/shared';

/**
 * Status of a file in the upload queue
 */
export type UploadFileStatus =
    | 'queued' // Waiting to be uploaded
    | 'uploading' // Currently uploading to server
    | 'processing' // Uploaded, waiting for OCR/thumbnail jobs
    | 'complete' // All processing done
    | 'error'; // Upload or processing failed

/**
 * A file in the upload queue with its status
 */
export interface UploadFile {
    /** Client-generated unique ID */
    id: string;
    /** The actual File object */
    file: File;
    /** Current status */
    status: UploadFileStatus;
    /** Upload progress (0-100) */
    uploadProgress: number;
    /** Processing progress (0-100, average of all jobs) */
    processingProgress: number;
    /** Server-assigned document ID after upload */
    documentId?: string;
    /** Associated jobs from the server */
    jobs?: Job[];
    /** Error message if status is 'error' */
    error?: string;
}

/**
 * An active upload session
 */
export interface UploadSession {
    /** Server-assigned session ID */
    sessionId: string;
    /** Files in this session */
    fileIds: string[];
    /** Start time */
    startedAt: Date;
}

/**
 * Overall upload state
 */
export interface UploadState {
    /** All files being tracked */
    files: Map<string, UploadFile>;
    /** Current session (if any) */
    session: UploadSession | null;
    /** Whether an upload is in progress */
    isUploading: boolean;
}

/**
 * Upload result from the API
 */
export interface UploadApiResult {
    session_id: string;
    documents: UploadedDocument[];
    jobs: Job[];
}

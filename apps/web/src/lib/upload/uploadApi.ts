import { UploadResponseSchema, type UploadResponse } from '@reverie/shared';
import { API_BASE, getAccessToken } from '../api/client';
import { getFileTooLargeMessage, isFileTooLarge } from './limits';

/**
 * Error message for a failed upload response. Prefers the server's message (JSON from the API);
 * a 413 without one comes from the reverse proxy (HTML page) and means the file exceeded its size limit.
 */
function getUploadErrorMessage(xhr: XMLHttpRequest, files: File[]): string {
    try {
        const error = JSON.parse(xhr.responseText);

        if (typeof error.message === 'string' && error.message.length > 0) {
            return error.message;
        }
    } catch {
        // Not a JSON response
    }

    if (xhr.status === 413) {
        return getFileTooLargeMessage(files.length === 1 ? files[0] : undefined);
    }

    return `Upload failed with status ${xhr.status}`;
}

/**
 * Message when the connection fails mid-upload. The server may drop the connection when a file exceeds
 * the size limit, in which case the browser only reports a network error.
 */
function getNetworkErrorMessage(files: File[]): string {
    const tooLarge = files.find(isFileTooLarge);

    return tooLarge ? getFileTooLargeMessage(tooLarge) : 'Network error during upload';
}

export type UploadOptions = {
    folderId?: string;
    sessionId: string;
    conflictStrategy?: 'replace' | 'keep_both';
    copyMetadataFromDocumentId?: string;
    onProgress?: (loaded: number, total: number) => void;
};

/**
 * Upload a single file to the server
 * @param sessionId - Client-generated session ID; subscribe to WebSocket with this before calling so job events are received
 * @param conflictStrategy - When duplicates exist: 'replace' or 'keep_both' (from duplicate options dialog)
 */
export async function uploadFile(file: File, options: UploadOptions): Promise<UploadResponse> {
    const { folderId, sessionId, conflictStrategy, copyMetadataFromDocumentId, onProgress } = options;
    const formData = new FormData();

    formData.append('files', file);

    if (folderId) {
        formData.append('folder_id', folderId);
    }

    formData.append('session_id', sessionId);

    if (conflictStrategy) {
        formData.append('conflict_strategy', conflictStrategy);
    }

    if (copyMetadataFromDocumentId) {
        formData.append('copy_metadata_from_document_id', copyMetadataFromDocumentId);
    }

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress(event.loaded, event.total);
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const parsed = JSON.parse(xhr.responseText);
                    resolve(UploadResponseSchema.parse(parsed));
                } catch {
                    reject(new Error('Invalid response from server'));
                }
            } else {
                reject(new Error(getUploadErrorMessage(xhr, [file])));
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error(getNetworkErrorMessage([file])));
        });

        xhr.addEventListener('abort', () => {
            reject(new Error('Upload was aborted'));
        });

        const token = getAccessToken();

        if (!token) {
            reject(new Error('Not authenticated'));

            return;
        }

        xhr.open('POST', `${API_BASE}/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.withCredentials = true;
        xhr.send(formData);
    });
}

/**
 * Upload multiple files to the server (bulk - single request)
 * @deprecated Use sequential upload via uploadFile in a loop for per-file progress and batch-size resilience
 */
export async function uploadFiles(files: File[], options: UploadOptions): Promise<UploadResponse> {
    const { folderId, sessionId, conflictStrategy, copyMetadataFromDocumentId, onProgress } = options;
    const formData = new FormData();

    for (const file of files) {
        formData.append('files', file);
    }

    if (folderId) {
        formData.append('folder_id', folderId);
    }

    formData.append('session_id', sessionId);

    if (conflictStrategy) {
        formData.append('conflict_strategy', conflictStrategy);
    }

    if (copyMetadataFromDocumentId) {
        formData.append('copy_metadata_from_document_id', copyMetadataFromDocumentId);
    }

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress(event.loaded, event.total);
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const parsed = JSON.parse(xhr.responseText);
                    resolve(UploadResponseSchema.parse(parsed));
                } catch {
                    reject(new Error('Invalid response from server'));
                }
            } else {
                reject(new Error(getUploadErrorMessage(xhr, files)));
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error(getNetworkErrorMessage(files)));
        });

        xhr.addEventListener('abort', () => {
            reject(new Error('Upload was aborted'));
        });

        const token = getAccessToken();

        if (!token) {
            reject(new Error('Not authenticated'));

            return;
        }

        xhr.open('POST', `${API_BASE}/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.withCredentials = true;
        xhr.send(formData);
    });
}

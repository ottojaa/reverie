import { UploadResponseSchema, type UploadResponse } from '@reverie/shared';
import { API_BASE, getAccessToken } from '../api/client';

export type UploadOptions = {
    folderId?: string;
    sessionId: string;
    conflictStrategy?: 'replace' | 'keep_both';
    onProgress?: (loaded: number, total: number) => void;
};

/**
 * Upload a single file to the server
 * @param sessionId - Client-generated session ID; subscribe to WebSocket with this before calling so job events are received
 * @param conflictStrategy - When duplicates exist: 'replace' or 'keep_both' (from duplicate options dialog)
 */
export async function uploadFile(file: File, options: UploadOptions): Promise<UploadResponse> {
    const { folderId, sessionId, conflictStrategy, onProgress } = options;
    const formData = new FormData();

    formData.append('files', file);

    if (folderId) {
        formData.append('folder_id', folderId);
    }

    formData.append('session_id', sessionId);

    if (conflictStrategy) {
        formData.append('conflict_strategy', conflictStrategy);
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
                try {
                    const error = JSON.parse(xhr.responseText);
                    reject(new Error(error.message || `Upload failed with status ${xhr.status}`));
                } catch {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'));
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
    const { folderId, sessionId, conflictStrategy, onProgress } = options;
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
                try {
                    const error = JSON.parse(xhr.responseText);
                    reject(new Error(error.message || `Upload failed with status ${xhr.status}`));
                } catch {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'));
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

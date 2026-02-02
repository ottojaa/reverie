import type { UploadApiResult } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Upload files to the server
 */
export async function uploadFiles(
    files: File[],
    accessToken: string,
    folderId?: string,
    onProgress?: (loaded: number, total: number) => void,
): Promise<UploadApiResult> {
    const formData = new FormData();

    for (const file of files) {
        formData.append('files', file);
    }

    if (folderId) {
        formData.append('folder_id', folderId);
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
                    const result = JSON.parse(xhr.responseText) as UploadApiResult;
                    resolve(result);
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

        xhr.open('POST', `${API_BASE}/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
        xhr.withCredentials = true;
        xhr.send(formData);
    });
}

import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_LABEL } from '@reverie/shared';
import { formatFileSize } from '../commonhelpers';
import type { UploadFile } from './types';

export { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_LABEL };

export function isFileTooLarge(file: Pick<File, 'size'>): boolean {
    return file.size > MAX_UPLOAD_FILE_SIZE_BYTES;
}

/** User-facing message for a file that exceeds the upload size limit. */
export function getFileTooLargeMessage(file?: Pick<File, 'size'>): string {
    const size = file ? ` (${formatFileSize(file.size)})` : '';

    return `File is too large${size}. The maximum upload size is ${MAX_UPLOAD_FILE_SIZE_LABEL} per file.`;
}

/** A failed upload that can be tried again: one over the size limit can never succeed. */
export function isRetryable(upload: UploadFile): boolean {
    return upload.status === 'error' && !isFileTooLarge(upload.file);
}

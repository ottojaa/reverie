import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_LABEL } from '@reverie/shared';
import { formatFileSize } from '../commonhelpers';

export { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_LABEL };

export function isFileTooLarge(file: Pick<File, 'size'>): boolean {
    return file.size > MAX_UPLOAD_FILE_SIZE_BYTES;
}

/** User-facing message for a file that exceeds the upload size limit. */
export function getFileTooLargeMessage(file?: Pick<File, 'size'>): string {
    const size = file ? ` (${formatFileSize(file.size)})` : '';

    return `File is too large${size}. The maximum upload size is ${MAX_UPLOAD_FILE_SIZE_LABEL} per file.`;
}

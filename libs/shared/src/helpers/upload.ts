/**
 * Maximum size of a single uploaded file.
 *
 * Decimal (SI) units to match how the UI formats sizes (see `formatFileSize` in the web app),
 * so "20 GB" in the UI and in error messages means exactly this many bytes.
 *
 * Keep in sync with `client_max_body_size` in the nginx configs (config/nginx*).
 */
export const MAX_UPLOAD_FILE_SIZE_BYTES = 20 * 1000 * 1000 * 1000;

/** Human-readable version of {@link MAX_UPLOAD_FILE_SIZE_BYTES} for messages. */
export const MAX_UPLOAD_FILE_SIZE_LABEL = '20 GB';

/**
 * The short uppercase label a file shows on its badge: the extension of its name when it is 4 characters or fewer,
 * else a MIME-derived fallback, else FILE. The same rule as the Android app's `fileTypeLabel`.
 */
export function fileTypeLabel(mime: string, filename: string): string {
    const dot = filename.lastIndexOf('.');
    const extension = dot < 0 ? '' : filename.slice(dot + 1).toUpperCase();

    if (extension !== '' && extension.length <= 4) return extension;

    if (mime === 'application/pdf') return 'PDF';

    if (mime === 'application/json') return 'JSON';

    if (mime.startsWith('text/')) return 'TXT';

    return 'FILE';
}

/**
 * Text extraction for plain-text files (TXT, MD, CSV).
 * PDF goes through PaddleOCR; this module handles text-based formats only.
 */

const MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB

const TEXT_MIME_TYPES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
]);

/**
 * Check if a MIME type supports text extraction (PDF or plain text).
 */
export function isTextExtractable(mimeType: string): boolean {
    if (mimeType === 'application/pdf') return true;
    return TEXT_MIME_TYPES.has(mimeType);
}

/**
 * Extract text from a buffer (TXT/MD/CSV only).
 * PDF is handled by PaddleOCR.
 */
export async function extractTextFromBuffer(
    buffer: Buffer,
    mimeType: string,
): Promise<{ text: string }> {
    if (!TEXT_MIME_TYPES.has(mimeType)) {
        return { text: '' };
    }

    if (buffer.length > MAX_BUFFER_SIZE) {
        return { text: '' };
    }

    try {
        return { text: buffer.toString('utf-8') };
    } catch {
        return { text: '' };
    }
}

/**
 * Format byte count for human display.
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

    if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;

    return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
}

/**
 * Format ISO date string for short display (e.g. "Jan 5, 2025").
 */
export function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

/**
 * Format ISO date string with weekday and time (e.g. "Mon, Jan 5, 2025, 3:45 PM").
 */
export function formatDateTime(dateString: string): string {
    return new Date(dateString).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Get pre-signed thumbnail URL for a document.
 */
export function getThumbnailUrl<T extends { thumbnail_urls?: { sm: string; md: string; lg: string } | null }>(
    document: T,
    size: 'sm' | 'md' | 'lg' = 'md',
): string | null {
    const url = document.thumbnail_urls?.[size];

    if (!url) return null;

    return `${API_BASE}${url}`;
}

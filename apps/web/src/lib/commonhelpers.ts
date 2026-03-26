/**
 * Format byte count for human display (base-10 SI units: 1 KB = 1000 B, 1 MB = 1000 KB).
 * Matches macOS Finder and modern storage conventions.
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`;

    if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`;

    if (bytes < 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;

    if (bytes < 1000 * 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000 * 1000)).toFixed(2)} GB`;

    return `${(bytes / (1000 * 1000 * 1000 * 1000)).toFixed(2)} TB`;
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

import { API_BASE } from './api/client';

/**
 * Build the full URL for a file from the API's file_url field.
 * Signed URLs from the API are relative paths; absolute URLs (e.g. S3) are used as-is.
 */
export function buildFileUrl(fileUrl: string | null): string | null {
    if (!fileUrl) return null;

    return fileUrl.startsWith('http') ? fileUrl : `${API_BASE}${fileUrl}`;
}

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

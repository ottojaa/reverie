import type { Document } from '@reverie/shared';
import type { ComponentType } from 'react';

/**
 * Props shared by all viewer components
 */
export interface ViewerProps {
    document: Document;
    fileUrl: string;
}

type ViewerComponent = ComponentType<ViewerProps>;

interface ViewerEntry {
    match: (mimeType: string) => boolean;
    load: () => Promise<{ default: ViewerComponent }>;
    label: string;
}

/**
 * Viewer registry — maps MIME types to lazy-loaded viewer components.
 * To add a new file type, append an entry here and create the component.
 */
const viewers: ViewerEntry[] = [
    {
        match: (m) => m.startsWith('image/'),
        load: () => import('./ImageViewer'),
        label: 'Image',
    },
    {
        match: (m) => m.startsWith('video/'),
        load: () => import('./VideoViewer'),
        label: 'Video',
    },
    {
        match: (m) => m === 'application/pdf',
        load: () => import('./PDFViewer'),
        label: 'PDF',
    },
    {
        match: (m) => m.startsWith('text/') || m === 'application/json',
        load: () => import('./TextViewer'),
        label: 'Text',
    },
];

/**
 * Extension-based fallback for files with generic MIME types like application/octet-stream.
 * Keyed by lowercase extension (without dot).
 */
const extensionFallbacks: Record<string, () => Promise<{ default: ViewerComponent }>> = {
    // Video
    mov: () => import('./VideoViewer'),
    mp4: () => import('./VideoViewer'),
    webm: () => import('./VideoViewer'),
    avi: () => import('./VideoViewer'),
    mkv: () => import('./VideoViewer'),
    m4v: () => import('./VideoViewer'),
    // Image
    heic: () => import('./ImageViewer'),
    heif: () => import('./ImageViewer'),
};

/**
 * Find the matching viewer entry for a MIME type
 */
export function getViewerEntry(mimeType: string): ViewerEntry | null {
    return viewers.find((v) => v.match(mimeType)) ?? null;
}

/**
 * Get the lazy component loader, falling back to extension detection then FallbackViewer.
 * Pass `filename` to enable extension-based fallback for generic MIME types.
 */
export function getViewerLoader(mimeType: string, filename?: string): () => Promise<{ default: ViewerComponent }> {
    // 1. Try MIME-based match first
    const entry = getViewerEntry(mimeType);

    if (entry) return entry.load;

    // 2. Fallback: try extension-based detection (handles application/octet-stream etc.)
    if (filename) {
        const ext = filename.split('.').pop()?.toLowerCase();

        if (ext) {
            const fallback = extensionFallbacks[ext];

            if (fallback) return fallback;
        }
    }

    return () => import('./FallbackViewer');
}

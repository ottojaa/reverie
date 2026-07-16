/**
 * Generated thumbnail WIDTH caps in pixels. The backend thumbnail worker
 * resizes with sharp's `resize(width, null, { fit: 'inside', withoutEnlargement: true })`,
 * so height scales with aspect ratio and small originals are never enlarged —
 * a portrait original can therefore be TALLER than its cap. The web dive
 * transition mirrors these caps to predict the viewer's on-screen image size.
 */
export const THUMBNAIL_SIZES = {
    sm: 384,
    md: 768,
    lg: 1440,
} as const;

export type ThumbnailSize = keyof typeof THUMBNAIL_SIZES;

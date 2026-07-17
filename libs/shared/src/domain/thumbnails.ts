/**
 * Generated thumbnail WIDTH caps in pixels. The backend thumbnail worker
 * resizes with sharp's `resize(width, null, { fit: 'inside', withoutEnlargement: true })`,
 * so height scales with aspect ratio and small originals are never enlarged —
 * a portrait original can therefore be TALLER than its cap. Thumbnails are
 * previews/placeholders only: nothing may derive on-screen layout from these
 * caps (stored thumbs keep whatever cap was current at generation time) —
 * the viewer and the dive transition size from the original's dimensions.
 */
export const THUMBNAIL_SIZES = {
    sm: 384,
    md: 768,
    lg: 1440,
} as const;

export type ThumbnailSize = keyof typeof THUMBNAIL_SIZES;

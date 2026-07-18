package com.reverie.app.data.image

import coil.memory.MemoryCache
import com.reverie.app.domain.model.ThumbnailSize

/**
 * The thumbnail size the gallery grid decodes. The document viewer reuses the same size as its
 * instant placeholder while the full-res image loads, so the two MUST agree — keep both pinned
 * to this one constant.
 */
val GRID_THUMBNAIL_SIZE = ThumbnailSize.MD

/**
 * Stable Coil memory-cache key for a document thumbnail. Set explicitly on BOTH the grid request
 * and the viewer's placeholder — Coil's default keys fold in the request's size/transformations,
 * so without a shared explicit key the cross-screen handoff misses and the thumbnail re-decodes.
 */
fun thumbnailMemoryCacheKey(documentId: String, size: ThumbnailSize): MemoryCache.Key =
    MemoryCache.Key("thumb-$documentId-${size.wire}")

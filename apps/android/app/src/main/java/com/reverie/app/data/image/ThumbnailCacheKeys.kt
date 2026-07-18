package com.reverie.app.data.image

import coil.memory.MemoryCache
import com.reverie.app.domain.model.ThumbnailSize

/**
 * The thumbnail size the gallery grid decodes. On the dense 3-column gallery a cell is ~130dp wide
 * (~350-400px), so MD (768px) keeps tiles crisp across densities; Coil downsamples to the measured
 * cell size, so it stays sharp without holding an oversized bitmap. (SM (384px) looked pixelated on
 * high-density screens — see PR #36.) The document viewer reuses this exact size as its instant
 * placeholder, so the two MUST agree — keep both pinned to this one constant.
 */
val GRID_THUMBNAIL_SIZE = ThumbnailSize.MD

/**
 * Stable Coil memory-cache key for a document thumbnail. Set explicitly on BOTH the grid request
 * and the viewer's placeholder — Coil's default keys fold in the request's size/transformations,
 * so without a shared explicit key the cross-screen handoff misses and the thumbnail re-decodes.
 */
fun thumbnailMemoryCacheKey(documentId: String, size: ThumbnailSize): MemoryCache.Key =
    MemoryCache.Key("thumb-$documentId-${size.wire}")

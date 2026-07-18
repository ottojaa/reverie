package com.reverie.app.data.image

import coil.map.Mapper
import coil.request.Options
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.domain.model.ThumbnailRef

/**
 * Maps a [ThumbnailRef] to the JWT-authed `/documents/:id/thumbnail/:size` URL. This endpoint
 * is stable (unlike the signed, expiring `thumbnail_urls`) and served with a 1-year
 * Cache-Control, so the resulting URL string is a durable Coil disk-cache key.
 */
class ThumbnailMapper(
    private val serverUrlProvider: ServerUrlProvider,
) : Mapper<ThumbnailRef, String> {
    override fun map(data: ThumbnailRef, options: Options): String =
        serverUrlProvider.current().removeSuffix("/") +
            "/documents/${data.documentId}/thumbnail/${data.size.wire}"
}

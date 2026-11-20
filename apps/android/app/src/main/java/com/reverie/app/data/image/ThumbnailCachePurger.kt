package com.reverie.app.data.image

import coil.ImageLoader
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize
import dagger.Lazy
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Removes cached thumbnails from Coil's caches. [remove] is for a document that turns out to be
 * private after it was already cached: Coil keys its disk entries by the mapped thumbnail URL, so
 * we rebuild that URL per size and drop it. [clearMemory] is for logout, so decoded private
 * thumbnails don't outlive the session in the memory cache.
 */
@Singleton
class ThumbnailCachePurger @Inject constructor(
    private val imageLoader: Lazy<ImageLoader>,
    private val serverUrlProvider: ServerUrlProvider,
) {
    fun remove(documentIds: Collection<String>) {
        val cache = imageLoader.get().diskCache ?: return
        for (id in documentIds) {
            for (size in ThumbnailSize.entries) {
                cache.remove(toThumbnailUrl(serverUrlProvider.current(), ThumbnailRef(id, size)))
            }
        }
    }

    fun clearMemory() {
        imageLoader.get().memoryCache?.clear()
    }
}

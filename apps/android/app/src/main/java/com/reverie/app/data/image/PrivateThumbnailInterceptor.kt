package com.reverie.app.data.image

import coil.intercept.Interceptor
import coil.request.CachePolicy
import coil.request.ImageResult
import com.reverie.app.data.local.PrivateDocumentStore
import com.reverie.app.domain.model.ThumbnailRef

/**
 * Keeps thumbnails of private documents out of Coil's disk cache. It runs for every request, so no
 * call site has to remember: a [ThumbnailRef] whose document is held in [PrivateDocumentStore] is
 * loaded with the disk cache disabled (memory cache only, which dies with the process).
 */
class PrivateThumbnailInterceptor(
    private val store: PrivateDocumentStore,
) : Interceptor {
    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
        val request = chain.request
        val ref = request.data as? ThumbnailRef ?: return chain.proceed(request)
        if (ref.documentId !in store.documents.value) return chain.proceed(request)
        return chain.proceed(request.newBuilder().diskCachePolicy(CachePolicy.DISABLED).build())
    }
}

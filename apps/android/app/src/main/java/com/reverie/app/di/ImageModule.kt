package com.reverie.app.di

import android.content.Context
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.SessionCookieStorage
import com.reverie.app.data.api.StorageCookieJar
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.image.AuthImageAuthenticator
import com.reverie.app.data.image.AuthImageInterceptor
import com.reverie.app.data.image.PrivateThumbnailInterceptor
import com.reverie.app.data.image.ThumbnailMapper
import com.reverie.app.data.local.PrivateDocumentStore
import dagger.Module
import dagger.Provides
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import javax.inject.Qualifier
import javax.inject.Singleton

/**
 * The authed OkHttp client shared by Coil thumbnails AND Media3 video streaming. One client = one
 * connection pool: a video open reuses the warm TLS connection the grid's thumbnail loads just
 * used, instead of paying a cold DNS+TCP+TLS handshake for the first byte of the stream.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class AuthedOkHttp

/** Compose-level access to the shared client — VideoViewer builds its ExoPlayer outside Hilt. */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface AuthedOkHttpEntryPoint {
    @AuthedOkHttp
    fun okHttpClient(): OkHttpClient
}

@Module
@InstallIn(SingletonComponent::class)
object ImageModule {

    private const val THUMB_DISK_CACHE_BYTES = 250L * 1024 * 1024

    // Renamed from "coil_thumbs" when private documents moved off disk: the old directory may hold
    // thumbnails of what are now private documents, and the Room migration deletes it (it can't be
    // purged selectively, and nothing has it open at that point).
    const val THUMB_CACHE_DIR = "coil_thumbs_v2"

    @Provides
    @Singleton
    @AuthedOkHttp
    fun provideAuthedOkHttpClient(
        authSessionManager: AuthSessionManager,
        cookieStorage: SessionCookieStorage,
    ): OkHttpClient =
        OkHttpClient.Builder()
            // Same cookie store as the Ktor client: private-folder thumbnails/video are only served
            // when the `vault_session` cookie (open folder locks) rides along.
            .cookieJar(StorageCookieJar(cookieStorage))
            .addInterceptor(AuthImageInterceptor(authSessionManager))
            .authenticator(AuthImageAuthenticator(authSessionManager))
            // Cold start fills the whole grid at once; the default 5 requests/host serialized the
            // authed thumbnail loads and was a major contributor to the slow initial stabilization.
            .dispatcher(Dispatcher().apply { maxRequests = 64; maxRequestsPerHost = 16 })
            .build()

    @Provides
    @Singleton
    fun provideImageLoader(
        @ApplicationContext context: Context,
        serverUrlProvider: ServerUrlProvider,
        privateStore: PrivateDocumentStore,
        @AuthedOkHttp okHttpClient: OkHttpClient,
    ): ImageLoader {
        return ImageLoader.Builder(context)
            .components {
                add(ThumbnailMapper(serverUrlProvider))
                add(PrivateThumbnailInterceptor(privateStore))
            }
            .okHttpClient(okHttpClient)
            // Explicit in-memory cache so thumbnails aren't re-decoded/re-fetched while the cold
            // disk cache fills. RGB_565 halves the bitmap footprint for the opaque JPEG thumbnails.
            .memoryCache { MemoryCache.Builder(context).maxSizePercent(0.30).build() }
            .allowRgb565(true)
            .diskCache(
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve(THUMB_CACHE_DIR))
                    .maxSizeBytes(THUMB_DISK_CACHE_BYTES)
                    .build(),
            )
            .respectCacheHeaders(false)
            .crossfade(true)
            .build()
    }
}

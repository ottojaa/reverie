package com.reverie.app.di

import android.content.Context
import coil.ImageLoader
import coil.disk.DiskCache
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.image.AuthImageAuthenticator
import com.reverie.app.data.image.AuthImageInterceptor
import com.reverie.app.data.image.ThumbnailMapper
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object ImageModule {

    private const val THUMB_DISK_CACHE_BYTES = 250L * 1024 * 1024

    @Provides
    @Singleton
    fun provideImageLoader(
        @ApplicationContext context: Context,
        serverUrlProvider: ServerUrlProvider,
        authSessionManager: AuthSessionManager,
    ): ImageLoader {
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(AuthImageInterceptor(authSessionManager))
            .authenticator(AuthImageAuthenticator(authSessionManager))
            .build()

        return ImageLoader.Builder(context)
            .components { add(ThumbnailMapper(serverUrlProvider)) }
            .okHttpClient(okHttpClient)
            .diskCache(
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("coil_thumbs"))
                    .maxSizeBytes(THUMB_DISK_CACHE_BYTES)
                    .build(),
            )
            .respectCacheHeaders(false)
            .crossfade(true)
            .build()
    }
}

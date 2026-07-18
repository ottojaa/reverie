package com.reverie.app.data.local

import android.content.Context
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.throwIfError
import com.reverie.app.data.local.dao.CachedFileDao
import com.reverie.app.data.local.entity.CachedFileEntity
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsChannel
import io.ktor.utils.io.jvm.javaio.toInputStream
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LRU cache of original files streamed to disk, backing the PDF viewer and offline reads.
 * Files larger than [MAX_CACHEABLE_BYTES] are streamed straight through rather than cached
 * (videos play via ExoPlayer against the signed URL and never come through here).
 */
@Singleton
class FileCacheManager @Inject constructor(
    @ApplicationContext context: Context,
    private val client: HttpClient,
    private val serverUrlProvider: ServerUrlProvider,
    private val documentsApi: DocumentsApi,
    private val cachedFileDao: CachedFileDao,
    private val settingsRepository: SettingsRepository,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    private val dir = File(context.cacheDir, "originals").apply { mkdirs() }

    /** Return the cached original file, downloading it on a cache miss. */
    suspend fun getOrFetch(documentId: String): File = withContext(io) {
        val cached = cachedFileDao.get(documentId)
        if (cached != null) {
            val file = File(dir, cached.relativePath)
            if (file.exists()) {
                cachedFileDao.touch(documentId, now())
                return@withContext file
            }
        }

        val document = documentsApi.get(documentId)
        val fileUrl = document.file_url ?: error("Document has no file URL: $documentId")
        val absolute = if (fileUrl.startsWith("http")) fileUrl
        else serverUrlProvider.current().removeSuffix("/") + fileUrl

        val target = File(dir, documentId)
        val response = client.get(absolute)
        response.throwIfError()
        response.bodyAsChannel().toInputStream().use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }

        cachedFileDao.upsert(
            CachedFileEntity(
                documentId = documentId,
                relativePath = documentId,
                sizeBytes = target.length(),
                mimeType = document.mime_type,
                lastAccessedAt = now(),
            ),
        )
        evictIfNeeded()
        target
    }

    suspend fun clear() = withContext(io) {
        cachedFileDao.clear()
        dir.listFiles()?.forEach { it.delete() }
    }

    private suspend fun evictIfNeeded() {
        val cap = settingsRepository.settings.first().fileCacheCapBytes
        var total = cachedFileDao.totalBytes()
        if (total <= cap) return
        for (entry in cachedFileDao.allByAccessAsc()) {
            if (total <= cap) break
            File(dir, entry.relativePath).delete()
            cachedFileDao.delete(entry.documentId)
            total -= entry.sizeBytes
        }
    }

    private fun now() = System.currentTimeMillis()

    private companion object {
        const val MAX_CACHEABLE_BYTES = 200L * 1024 * 1024
    }
}

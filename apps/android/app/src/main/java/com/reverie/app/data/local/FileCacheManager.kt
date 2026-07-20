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
import io.ktor.http.contentLength
import io.ktor.utils.io.jvm.javaio.toInputStream
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.File
import java.io.InputStream
import java.io.OutputStream
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

    /**
     * Return the cached original file, downloading it on a cache miss. [onProgress] receives the
     * download fraction (0f‥1f) on each whole-percent change while streaming — only on the miss
     * path (a cache hit returns instantly and never reports), and only when the server sends a
     * Content-Length so a real fraction is known; otherwise the load stays indeterminate.
     */
    suspend fun getOrFetch(documentId: String, onProgress: ((Float) -> Unit)? = null): File = withContext(io) {
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
        val total = response.contentLength()
        response.bodyAsChannel().toInputStream().use { input ->
            target.outputStream().use { output -> copyReporting(input, output, total, onProgress) }
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

    /**
     * Stream [input] to [output], reporting the download fraction to [onProgress] whenever the whole
     * percent advances (so a large file yields ≤100 UI updates, not one per buffer). Progress is
     * skipped when [total] is unknown/zero — the caller then shows an indeterminate bar.
     */
    private fun copyReporting(input: InputStream, output: OutputStream, total: Long?, onProgress: ((Float) -> Unit)?) {
        val buffer = ByteArray(COPY_BUFFER_BYTES)
        var copied = 0L
        var lastPercent = -1
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            copied += read
            if (onProgress == null || total == null || total <= 0L) continue
            val percent = (copied * 100 / total).toInt().coerceIn(0, 100)
            if (percent == lastPercent) continue
            lastPercent = percent
            onProgress(percent / 100f)
        }
    }

    private companion object {
        const val MAX_CACHEABLE_BYTES = 200L * 1024 * 1024
        const val COPY_BUFFER_BYTES = 64 * 1024
    }
}

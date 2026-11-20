package com.reverie.app.data.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.reverie.app.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

private const val BUFFER_BYTES = 64 * 1024
private const val PROGRESS_INTERVAL_NANOS = 100_000_000L

/**
 * SHA-256 of everything [this] stream yields, as lower-case hex: the value the server stores as
 * `documents.file_hash`. Streams through [MessageDigest] in 64 KiB blocks, so a multi-gigabyte video never
 * sits in memory, and checks for cancellation between blocks. [onBytes] gets the running total.
 */
suspend fun InputStream.sha256Hex(onBytes: (Long) -> Unit = {}): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_BYTES)
    var total = 0L
    while (true) {
        currentCoroutineContext().ensureActive()
        val read = read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
        total += read
        onBytes(total)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

/** How far [ContentHasher.hashAll] has got, for a progress bar: bytes when sizes are known, else files. */
data class HashProgress(val filesDone: Int, val filesTotal: Int, val bytesDone: Long, val bytesTotal: Long) {
    val fraction: Float
        get() = when {
            bytesTotal > 0 -> (bytesDone.toDouble() / bytesTotal).toFloat().coerceIn(0f, 1f)
            filesTotal > 0 -> filesDone.toFloat() / filesTotal
            else -> 0f
        }
}

/**
 * Hashes picked files straight from their `content://` URIs. Opens each one exactly as [UploadStager]
 * does (see [openOriginal]), so the hash is of the bytes that will be uploaded and equals the server's
 * `file_hash` for them. Reusable by anything that needs a file's content identity (the auto-backup run).
 */
@Singleton
class ContentHasher @Inject constructor(
    @ApplicationContext private val context: Context,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    /** The SHA-256 of [uri]'s content, or null when it can't be opened or read. Cancellable. */
    suspend fun hash(uri: Uri, onBytes: (Long) -> Unit = {}): String? = withContext(io) {
        val stream = context.contentResolver.openOriginal(uri) ?: return@withContext null
        try {
            stream.use { it.sha256Hex(onBytes) }
        } catch (e: java.io.IOException) {
            null
        }
    }

    /** Hashes [uris] one after another; an unreadable file yields null in its slot. */
    suspend fun hashAll(uris: List<Uri>, onProgress: (HashProgress) -> Unit = {}): List<String?> = withContext(io) {
        val sizes = uris.map { querySize(it) }
        val bytesTotal = sizes.sum()
        var bytesBefore = 0L
        var lastEmit = 0L
        uris.mapIndexed { index, uri ->
            onProgress(HashProgress(index, uris.size, bytesBefore, bytesTotal))
            val hash = hash(uri) { done ->
                // One callback per 64 KiB block would be tens of thousands of UI updates for a big video.
                val now = System.nanoTime()
                if (now - lastEmit >= PROGRESS_INTERVAL_NANOS) {
                    lastEmit = now
                    onProgress(HashProgress(index, uris.size, bytesBefore + done, bytesTotal))
                }
            }
            bytesBefore += sizes[index]
            hash
        }.also { onProgress(HashProgress(uris.size, uris.size, bytesTotal, bytesTotal)) }
    }

    private fun querySize(uri: Uri): Long = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (cursor.moveToFirst() && index >= 0 && !cursor.isNull(index)) cursor.getLong(index) else 0L
        } ?: 0L
    }.getOrDefault(0L)
}

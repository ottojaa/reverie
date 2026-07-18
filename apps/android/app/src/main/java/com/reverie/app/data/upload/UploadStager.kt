package com.reverie.app.data.upload

import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import com.reverie.app.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class StagedFile(
    val id: String,
    val path: String,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
)

/**
 * Byte-copies `content://` streams into `filesDir/upload_staging/<sessionId>/` so the upload
 * survives process death (URI grants don't). For image URIs it reads via
 * [MediaStore.setRequireOriginal] so EXIF GPS survives — the reason we don't use the system
 * Photo Picker, which unconditionally redacts location.
 */
@Singleton
class UploadStager @Inject constructor(
    @ApplicationContext private val context: Context,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    private val root = File(context.filesDir, "upload_staging")

    suspend fun stage(sessionId: String, uris: List<Uri>): List<StagedFile> = withContext(io) {
        val dir = File(root, sessionId).apply { mkdirs() }
        uris.mapNotNull { uri -> stageOne(dir, sessionId, uri) }
    }

    private fun stageOne(dir: File, sessionId: String, uri: Uri): StagedFile? = runCatching {
        val resolver = context.contentResolver
        val meta = queryMeta(uri)
        val mime = resolver.getType(uri) ?: "application/octet-stream"

        val readUri = if (mime.startsWith("image/")) {
            runCatching { MediaStore.setRequireOriginal(uri) }.getOrDefault(uri)
        } else {
            uri
        }

        val target = File(dir, "${UUID.randomUUID()}_${meta.name}")
        val stream = runCatching { resolver.openInputStream(readUri) }.getOrNull()
            ?: resolver.openInputStream(uri)
            ?: return@runCatching null
        stream.use { input -> target.outputStream().use { input.copyTo(it) } }

        StagedFile(
            id = UUID.randomUUID().toString(),
            path = target.absolutePath,
            displayName = meta.name,
            mimeType = mime,
            sizeBytes = target.length(),
        )
    }.getOrNull()

    fun cleanup(sessionId: String) {
        File(root, sessionId).deleteRecursively()
    }

    /** Remove staging dirs for sessions that are no longer tracked. */
    fun sweepOrphans(activeSessionIds: Set<String>) {
        root.listFiles()?.forEach { dir ->
            if (dir.name !in activeSessionIds) dir.deleteRecursively()
        }
    }

    private data class Meta(val name: String, val size: Long)

    private fun queryMeta(uri: Uri): Meta {
        var name = "file"
        var size = 0L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) name = cursor.getString(nameIdx)
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
                }
            }
        return Meta(name, size)
    }
}

package com.reverie.app.data.backup

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.provider.MediaStore.Files.FileColumns
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.FoldersApi
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.UploadApi
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.repository.checkContentInBatches
import com.reverie.app.data.upload.ContentHasher
import com.reverie.app.data.upload.openOriginal
import com.reverie.app.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Lists the device's photos and videos from MediaStore, newest first. Needs the media read permission. */
@Singleton
class MediaStoreBackupSource @Inject constructor(
    @ApplicationContext private val context: Context,
    @IoDispatcher private val io: CoroutineDispatcher,
) : BackupMediaSource {

    override suspend fun queryMedia(): List<BackupMedia> = withContext(io) {
        val projection = arrayOf(
            FileColumns._ID, FileColumns.DISPLAY_NAME, FileColumns.MIME_TYPE, FileColumns.SIZE, FileColumns.BUCKET_ID, FileColumns.BUCKET_DISPLAY_NAME,
            FileColumns.DATE_ADDED,
        )
        val selection = "${FileColumns.MEDIA_TYPE} IN (?, ?)"
        val args = arrayOf(FileColumns.MEDIA_TYPE_IMAGE.toString(), FileColumns.MEDIA_TYPE_VIDEO.toString())
        val media = mutableListOf<BackupMedia>()
        // A SecurityException (permission revoked) propagates: the worker reports it as a permission problem.
        context.contentResolver.query(filesUri(), projection, selection, args, "${FileColumns.DATE_ADDED} DESC, ${FileColumns._ID} DESC")
            ?.use { cursor ->
                val id = cursor.getColumnIndexOrThrow(FileColumns._ID)
                val name = cursor.getColumnIndexOrThrow(FileColumns.DISPLAY_NAME)
                val mime = cursor.getColumnIndexOrThrow(FileColumns.MIME_TYPE)
                val size = cursor.getColumnIndexOrThrow(FileColumns.SIZE)
                val bucket = cursor.getColumnIndexOrThrow(FileColumns.BUCKET_ID)
                val bucketName = cursor.getColumnIndexOrThrow(FileColumns.BUCKET_DISPLAY_NAME)
                val added = cursor.getColumnIndexOrThrow(FileColumns.DATE_ADDED)
                while (cursor.moveToNext()) {
                    media += BackupMedia(
                        id = cursor.getLong(id),
                        displayName = cursor.getString(name) ?: "media-${cursor.getLong(id)}",
                        mimeType = cursor.getString(mime) ?: "application/octet-stream",
                        sizeBytes = cursor.getLong(size),
                        bucketId = cursor.getLong(bucket),
                        bucketName = cursor.getString(bucketName).orEmpty(),
                        addedAt = cursor.getLong(added),
                    )
                }
            }
        media
    }
}

internal fun filesUri(): Uri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)

/** The `content://` URI of a MediaStore item; nothing is copied, the bytes are read from it. */
internal fun BackupMedia.toUri(): Uri = ContentUris.withAppendedId(filesUri(), id)

/** Hashes and uploads straight from MediaStore URIs, and asks the server what it has and where to put it. */
@Singleton
class MediaStoreBackupTransport @Inject constructor(
    @ApplicationContext private val context: Context,
    private val hasher: ContentHasher,
    private val documentsApi: DocumentsApi,
    private val uploadApi: UploadApi,
    private val foldersApi: FoldersApi,
) : BackupTransport {

    override suspend fun hash(media: BackupMedia): String? = hasher.hash(media.toUri(), mimeType = media.mimeType)

    override suspend fun checkContent(files: List<CheckContentFile>): List<CheckContentResult> =
        reportingNetwork { documentsApi.checkContentInBatches(DocumentScope.All, files) }

    override suspend fun upload(media: BackupMedia, folderId: String): String? {
        val uri = media.toUri()
        val response = try {
            uploadApi.uploadStream(
                sessionId = UUID.randomUUID().toString(),
                folderId = folderId,
                filename = media.displayName,
                mimeType = media.mimeType,
                // Two files with the same name must never overwrite each other.
                conflictStrategy = "keep_both",
                size = media.sizeBytes.takeIf { it > 0 },
                // Same opener as the hash, so what is uploaded is what was checked (original, GPS included).
                openStream = { openForUpload(uri, media.mimeType) },
            )
        } catch (e: IOException) {
            // A failure reading the file is that file's problem; any other I/O failure is the network's.
            if (e.hasCause<MediaReadException>()) throw e
            throw ReverieApiException.Network(e)
        }
        return response.documents.firstOrNull()?.id
    }

    private fun openForUpload(uri: Uri, mimeType: String): InputStream {
        val stream = try {
            context.contentResolver.openOriginal(uri, mimeType) ?: throw FileNotFoundException()
        } catch (e: IOException) {
            throw MediaReadException(e)
        }
        return MediaReadStream(stream)
    }

    override suspend fun createFolder(name: String, parentId: String?): String =
        reportingNetwork { foldersApi.create(CreateFolderRequest(name, parentId)).id }

    override suspend fun listFolders(parentId: String?): List<FolderDto> =
        reportingNetwork { foldersApi.children(parentId) }

    private suspend fun <T> reportingNetwork(call: suspend () -> T): T = try {
        call()
    } catch (e: IOException) {
        // The HTTP client reports a lost connection, an unknown host or a timeout as a plain IOException.
        throw ReverieApiException.Network(e)
    }
}

/** An I/O failure from the device file itself, as opposed to the connection to the server. */
internal class MediaReadException(cause: IOException) : IOException("Couldn't read the file", cause)

/** Tags every read failure of [inner] as a [MediaReadException]. */
private class MediaReadStream(private val inner: InputStream) : InputStream() {
    override fun read(): Int = tagged { inner.read() }
    override fun read(b: ByteArray, off: Int, len: Int): Int = tagged { inner.read(b, off, len) }
    override fun close() = inner.close()

    private inline fun <T> tagged(block: () -> T): T = try {
        block()
    } catch (e: IOException) {
        throw MediaReadException(e)
    }
}

private inline fun <reified T : Throwable> Throwable.hasCause(): Boolean =
    generateSequence(this) { it.cause }.any { it is T }

package com.reverie.app.data.backup

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.provider.MediaStore.Files.FileColumns
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.UploadApi
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.repository.checkContentInBatches
import com.reverie.app.data.upload.ContentHasher
import com.reverie.app.data.upload.openOriginal
import com.reverie.app.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.FileNotFoundException
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
                while (cursor.moveToNext()) {
                    media += BackupMedia(
                        id = cursor.getLong(id),
                        displayName = cursor.getString(name) ?: "media-${cursor.getLong(id)}",
                        mimeType = cursor.getString(mime) ?: "application/octet-stream",
                        sizeBytes = cursor.getLong(size),
                        bucketId = cursor.getLong(bucket),
                        bucketName = cursor.getString(bucketName).orEmpty(),
                    )
                }
            }
        media
    }
}

internal fun filesUri(): Uri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)

/** The `content://` URI of a MediaStore item; nothing is copied, the bytes are read from it. */
internal fun BackupMedia.toUri(): Uri = ContentUris.withAppendedId(filesUri(), id)

/** Hashes and uploads straight from MediaStore URIs, and asks the server what it already has. */
@Singleton
class MediaStoreBackupTransport @Inject constructor(
    @ApplicationContext private val context: Context,
    private val hasher: ContentHasher,
    private val documentsApi: DocumentsApi,
    private val uploadApi: UploadApi,
) : BackupTransport {

    override suspend fun hash(media: BackupMedia): String? = hasher.hash(media.toUri())

    override suspend fun checkContent(files: List<CheckContentFile>): List<CheckContentResult> =
        documentsApi.checkContentInBatches(folderId = null, files = files)

    override suspend fun upload(media: BackupMedia, folderId: String): String? {
        val uri = media.toUri()
        val response = uploadApi.uploadStream(
            sessionId = UUID.randomUUID().toString(),
            folderId = folderId,
            filename = media.displayName,
            mimeType = media.mimeType,
            // Two files with the same name must never overwrite each other.
            conflictStrategy = "keep_both",
            size = media.sizeBytes.takeIf { it > 0 },
            // Same opener as the hash, so what is uploaded is what was checked (original, GPS included).
            openStream = { context.contentResolver.openOriginal(uri, media.mimeType) ?: throw FileNotFoundException() },
        )
        return response.documents.firstOrNull()?.id
    }
}

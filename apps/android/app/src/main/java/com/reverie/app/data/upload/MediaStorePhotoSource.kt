package com.reverie.app.data.upload

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import com.reverie.app.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

data class MediaAsset(
    val uri: Uri,
    val isVideo: Boolean,
    val displayName: String,
)

/**
 * Queries the device's photos and videos via MediaStore for the in-app picker grid. Reading
 * originals (for EXIF GPS) happens later in [UploadStager] with setRequireOriginal.
 */
@Singleton
class MediaStorePhotoSource @Inject constructor(
    @ApplicationContext private val context: Context,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    suspend fun queryRecent(limit: Int = 300): List<MediaAsset> = withContext(io) {
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
        )
        val selection = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (?, ?)"
        val args = arrayOf(
            MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
            MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
        )
        val sortOrder = "${MediaStore.Files.FileColumns.DATE_ADDED} DESC"

        val result = mutableListOf<MediaAsset>()
        context.contentResolver.query(collection, projection, selection, args, sortOrder)?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val typeCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
            while (cursor.moveToNext() && result.size < limit) {
                val id = cursor.getLong(idCol)
                val isVideo = cursor.getInt(typeCol) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                result += MediaAsset(
                    uri = ContentUris.withAppendedId(collection, id),
                    isVideo = isVideo,
                    displayName = cursor.getString(nameCol) ?: "media",
                )
            }
        }
        result
    }
}

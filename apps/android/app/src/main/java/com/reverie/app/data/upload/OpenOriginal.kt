package com.reverie.app.data.upload

import android.content.ContentResolver
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.InputStream

/**
 * Opens [uri] for reading the bytes that get uploaded. Image URIs are opened via
 * [MediaStore.setRequireOriginal] (API 29+) so EXIF GPS survives, falling back to the plain URI.
 *
 * The one place that decides this: [UploadStager] copies what it returns and [ContentHasher] hashes it, so
 * the hash of a file and the file that is uploaded can't drift apart.
 */
fun ContentResolver.openOriginal(uri: Uri, mimeType: String? = getType(uri)): InputStream? {
    val readUri = if (mimeType?.startsWith("image/") == true && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        runCatching { MediaStore.setRequireOriginal(uri) }.getOrDefault(uri)
    } else {
        uri
    }
    return runCatching { openInputStream(readUri) }.getOrNull() ?: openInputStream(uri)
}

package com.reverie.app.util

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

/**
 * Share a cached original file via ACTION_SEND. The signed file URL isn't shared (it expires and
 * share targets expect a content stream); we hand out a FileProvider URI for the on-disk cache
 * copy, using the 4-arg overload so the recipient sees the real [displayName] rather than the
 * document-id the cache file is named after.
 */
fun shareDocumentFile(context: Context, file: File, mimeType: String, displayName: String) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file, displayName)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = mimeType.ifBlank { "application/octet-stream" }
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri(displayName, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
}

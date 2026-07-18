package com.reverie.app.util

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment

/**
 * Enqueue a file download to the public Downloads folder. [url] is the signed file URL;
 * `download=1` asks the server for a Content-Disposition: attachment response.
 */
fun enqueueDownload(context: Context, url: String, filename: String) {
    val separator = if (url.contains('?')) "&" else "?"
    val downloadUrl = "$url${separator}download=1&dl=${Uri.encode(filename)}"

    val request = DownloadManager.Request(Uri.parse(downloadUrl))
        .setTitle(filename)
        .setDescription("Downloading from Reverie")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
        .setAllowedOverMetered(true)

    val manager = context.getSystemService(DownloadManager::class.java)
    manager?.enqueue(request)
}

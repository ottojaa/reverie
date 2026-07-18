package com.reverie.app.ui.screens.viewer

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.screens.viewer.viewers.FallbackViewer
import com.reverie.app.ui.screens.viewer.viewers.ImageViewer
import com.reverie.app.ui.screens.viewer.viewers.PdfViewer
import com.reverie.app.ui.screens.viewer.viewers.TextViewer
import com.reverie.app.ui.screens.viewer.viewers.VideoViewer
import java.io.File

private enum class ViewerType { IMAGE, VIDEO, PDF, TEXT, FALLBACK }

private val extensionFallback = mapOf(
    "mov" to ViewerType.VIDEO, "mp4" to ViewerType.VIDEO, "webm" to ViewerType.VIDEO,
    "avi" to ViewerType.VIDEO, "mkv" to ViewerType.VIDEO, "m4v" to ViewerType.VIDEO,
    "heic" to ViewerType.IMAGE, "heif" to ViewerType.IMAGE,
)

private fun viewerTypeFor(mimeType: String, filename: String): ViewerType = when {
    mimeType.startsWith("image/") -> ViewerType.IMAGE
    mimeType.startsWith("video/") -> ViewerType.VIDEO
    mimeType == "application/pdf" -> ViewerType.PDF
    mimeType.startsWith("text/") || mimeType == "application/json" -> ViewerType.TEXT
    else -> extensionFallback[filename.substringAfterLast('.', "").lowercase()] ?: ViewerType.FALLBACK
}

/** Mirrors the web viewer registry: dispatches to the right viewer by MIME (+ extension fallback). */
@Composable
fun DocumentViewerBody(
    document: DocumentDto,
    fileUrl: String?,
    loadFile: suspend () -> File,
    onToggleImmersive: () -> Unit,
    onDownload: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (viewerTypeFor(document.mime_type, document.original_filename)) {
        ViewerType.IMAGE -> ImageViewer(fileUrl = fileUrl, contentDescription = document.original_filename, onTap = onToggleImmersive, modifier = modifier)
        ViewerType.VIDEO -> VideoViewer(fileUrl = fileUrl, modifier = modifier)
        ViewerType.PDF -> PdfViewer(loadFile = loadFile, modifier = modifier)
        ViewerType.TEXT -> TextViewer(loadFile = loadFile, modifier = modifier)
        ViewerType.FALLBACK -> FallbackViewer(document = document, onDownload = onDownload, modifier = modifier)
    }
}

package com.reverie.app.ui.screens.viewer

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
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

/**
 * Whether this document opens in the zoomable [ImageViewer] (image MIME, or a heic/heif fallback).
 * Only images fit themselves into an aspect-matched box for the dive transform — every other viewer
 * wants the full screen (see DocumentScreen), so callers gate the aspect box on this.
 */
fun isImageDocument(document: DocumentDto): Boolean =
    viewerTypeFor(document.mime_type, document.original_filename) == ViewerType.IMAGE

/** Mirrors the web viewer registry: dispatches to the right viewer by MIME (+ extension fallback). */
@Composable
fun DocumentViewerBody(
    document: DocumentDto,
    fileUrl: String?,
    loadFile: suspend () -> File,
    onMediaTap: () -> Unit,
    onDownload: () -> Unit,
    modifier: Modifier = Modifier,
    // Whether this document is the pager's settled page. Non-settled image pages reset their zoom so
    // a zoomed-in image doesn't restore its transform when swiped back to. Defaults true for callers
    // outside the pager.
    isSettledPage: Boolean = true,
    // While the details pane is open the media is lifted out of the way; disable each viewer's own
    // zoom/scroll so it doesn't fight the pane's drag-to-close.
    detailsOpen: Boolean = false,
    // Reports whether the image is pinch-zoomed (image viewer only), so the chrome can hide.
    onZoomChanged: (Boolean) -> Unit = {},
) {
    when (viewerTypeFor(document.mime_type, document.original_filename)) {
        ViewerType.IMAGE -> ImageViewer(
            fileUrl = fileUrl,
            documentId = document.id,
            hasThumbnail = document.hasRenderedThumbnail,
            contentDescription = document.original_filename,
            onTap = onMediaTap,
            isSettledPage = isSettledPage,
            gesturesEnabled = !detailsOpen,
            onZoomChanged = onZoomChanged,
            modifier = modifier,
        )
        ViewerType.VIDEO -> VideoViewer(fileUrl = fileUrl, modifier = modifier)
        ViewerType.PDF -> PdfViewer(loadFile = loadFile, scrollEnabled = !detailsOpen, modifier = modifier)
        ViewerType.TEXT -> TextViewer(loadFile = loadFile, scrollEnabled = !detailsOpen, modifier = modifier)
        ViewerType.FALLBACK -> FallbackViewer(document = document, onDownload = onDownload, modifier = modifier)
    }
}

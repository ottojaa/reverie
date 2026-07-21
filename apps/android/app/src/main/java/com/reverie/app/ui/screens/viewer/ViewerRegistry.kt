package com.reverie.app.ui.screens.viewer

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.ui.screens.viewer.viewers.FallbackViewer
import com.reverie.app.ui.screens.viewer.viewers.ImageViewer
import com.reverie.app.ui.screens.viewer.viewers.PdfViewer
import com.reverie.app.ui.screens.viewer.viewers.TextViewer
import com.reverie.app.ui.screens.viewer.viewers.VideoViewer
import java.io.File

internal enum class ViewerType { IMAGE, VIDEO, PDF, TEXT, FALLBACK }

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

/** The viewer this document dispatches to — also drives the dive stand-in (see DocumentPage). */
internal fun viewerTypeFor(document: DocumentDto): ViewerType =
    viewerTypeFor(document.mime_type, document.original_filename)

/** Whether this document opens in the zoomable [ImageViewer] (image MIME, or a heic/heif fallback). */
fun isImageDocument(document: DocumentDto): Boolean = viewerTypeFor(document) == ViewerType.IMAGE

/**
 * Whether this document plays in the [VideoViewer]. Media (images + videos) size the dive
 * transform to their aspect — the morph box is the content rect the poster grows into — so the
 * grid passes their aspect as the nav arg (see BrowseScreen).
 */
fun isVideoDocument(document: DocumentDto): Boolean = viewerTypeFor(document) == ViewerType.VIDEO

/** Mirrors the web viewer registry: dispatches to the right viewer by MIME (+ extension fallback). */
@Composable
fun DocumentViewerBody(
    document: DocumentDto,
    fileUrl: String?,
    loadFile: suspend (onProgress: (Float) -> Unit) -> File,
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
    // Reports whether the media is pinch-zoomed (image + PDF viewers), so the chrome can hide and
    // the details drawer stays put while the viewer owns its gestures.
    onZoomChanged: (Boolean) -> Unit = {},
    // Fired once the image viewer first shows drawable content, so DocumentPage can drop the dive
    // hero it draws behind an image (else over-zoom-out reveals that static hero). Image only.
    onImageContentVisible: () -> Unit = {},
    // Reports whether the app chrome should hide (video viewer only) — while playing or while the
    // video's own controls are visible, so the app bars never overlap Media3's controls.
    onChromeHidden: (Boolean) -> Unit = {},
    // Fired when the video renders its first frame (video viewer only), so DocumentPage can fade the
    // fill cover it holds over the player.
    onFirstFrameRendered: () -> Unit = {},
    // Whether the video's PlayerView surface should be attached (video viewer only). The player
    // itself lives with the composable so it can buffer through the open dive; the surface waits
    // for the dive to settle (see DocumentPage).
    mountVideoSurface: Boolean = true,
    // Poster frame offset (ms) the video should park its first frame at (video viewer only), so it
    // matches the thumbnail poster — null when there's no poster. See VideoViewer.posterSeekMs.
    videoPosterSeekMs: Long? = null,
) {
    when (viewerTypeFor(document.mime_type, document.original_filename)) {
        ViewerType.IMAGE -> ImageViewer(
            documentId = document.id,
            // Real pixel size lets the zoomable enable gestures on the thumbnail before the original
            // loads; null when dimensions are unknown (zoom then waits for sub-sampling to size it).
            contentSize = document.width?.let { w -> document.height?.let { h -> Size(w.toFloat(), h.toFloat()) } },
            hasThumbnail = document.hasRenderedThumbnail,
            contentDescription = document.original_filename,
            loadFile = loadFile,
            onTap = onMediaTap,
            isSettledPage = isSettledPage,
            gesturesEnabled = !detailsOpen,
            onZoomChanged = onZoomChanged,
            onContentVisible = onImageContentVisible,
            modifier = modifier,
        )
        ViewerType.VIDEO -> VideoViewer(
            fileUrl = fileUrl,
            mountSurface = mountVideoSurface,
            posterSeekMs = videoPosterSeekMs,
            onChromeHidden = onChromeHidden,
            onFirstFrameRendered = onFirstFrameRendered,
            modifier = modifier,
        )
        ViewerType.PDF -> PdfViewer(
            loadFile = loadFile,
            scrollEnabled = !detailsOpen,
            onTap = onMediaTap,
            onZoomChanged = onZoomChanged,
            modifier = modifier,
        )
        ViewerType.TEXT -> TextViewer(loadFile = loadFile, scrollEnabled = !detailsOpen, modifier = modifier)
        ViewerType.FALLBACK -> FallbackViewer(document = document, onDownload = onDownload, modifier = modifier)
    }
}

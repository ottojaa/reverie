package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.data.settings.VideoBackground
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.screens.viewer.ViewerType
import com.reverie.app.ui.screens.viewer.viewerTypeFor

/**
 * Type-correct stand-ins for the document-open container transform (the "dive").
 *
 * The tile→viewer morph only reads as a true shared element when the morphing box already looks
 * like what the settled viewer will show. Images (and aspect-known videos) get that for free —
 * the [DocumentDiveHero] thumbnail IS the final content, so DocumentPage morphs it directly.
 * Every other type morphs one of these instead: the player's letterboxed poster, the PDF's first
 * page, or the fallback card. The real viewer then fades in over the settled stand-in, and fades
 * back out over it on the dive back (see DocumentPage).
 */
@Composable
fun DocumentDiveStandIn(
    document: DocumentDto,
    videoBackground: VideoBackground,
    modifier: Modifier = Modifier,
) {
    when (viewerTypeFor(document)) {
        // Media normally morph the DiveHero in an aspect box; these branches are the fallbacks for
        // an image/video whose aspect (or poster) is unknown, where the box is full-screen.
        ViewerType.IMAGE -> DocumentDiveHero(document.id, modifier)
        ViewerType.VIDEO -> VideoPosterStandIn(document, videoBackground, modifier)
        // Text and thumb-less PDFs DO have a viewer — but no preview image to morph. Show the bare
        // themed surface the viewer draws on (never the file-type icon card, which reads as "no
        // viewer"), so the tile morphs into the opening document and the real content fades in over
        // a matching backdrop instead of abruptly replacing an icon.
        ViewerType.TEXT -> PlainBackdropStandIn(modifier)
        ViewerType.PDF ->
            if (document.hasRenderedThumbnail) PdfPageStandIn(document, modifier)
            else PlainBackdropStandIn(modifier)
        // Exactly what settles: the real FallbackViewer replaces this pixel-for-pixel, so the
        // inert download action is covered by the live one before it could be tapped.
        ViewerType.FALLBACK -> FallbackViewer(document, onDownload = {}, modifier = modifier)
    }
}

/**
 * The bare themed backdrop a content viewer (text, thumb-less PDF) draws on, used as its dive
 * stand-in: the tile morphs into a solid "opening" surface and the real content fades in over the
 * same colour — no file-type icon, which would read as a no-preview fallback.
 */
@Composable
private fun PlainBackdropStandIn(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background))
}

/**
 * What fills the letterbox area around a video, outside its content rect. Drawn by DocumentPage
 * as a full-screen layer BEHIND the poster hero and the player — lifted into the shared-transition
 * overlay with a fast dim-in (see videoBackdropInOverlay), so it darkens in sync with the morph box
 * instead of riding the screen fade — and stays as the player's backdrop after settle; it never
 * pops in when the player mounts.
 */
@Composable
fun VideoLetterboxFill(
    background: VideoBackground,
    documentId: String,
    hasPoster: Boolean,
    modifier: Modifier = Modifier,
) {
    when {
        background == VideoBackground.THEME -> Box(modifier.background(MaterialTheme.colorScheme.background))
        // Reuse the cached poster thumbnail, heavily blurred, as a filled backdrop.
        background == VideoBackground.BLURRED && hasPoster -> DocumentDiveHero(documentId, modifier.blur(28.dp))
        else -> Box(modifier.background(Color.Black))
    }
}

/**
 * A video with no known aspect (so no aspect-matched hero box): the settled player's composition —
 * the chosen fill with the poster FIT inside it — so the morph lands on the real letterboxing
 * instead of a cropped mirror of the frame.
 */
@Composable
private fun VideoPosterStandIn(
    document: DocumentDto,
    videoBackground: VideoBackground,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        VideoLetterboxFill(videoBackground, document.id, document.hasRenderedThumbnail, Modifier.fillMaxSize())
        if (document.hasRenderedThumbnail) {
            DocumentDiveHero(document.id, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        }
    }
}

/**
 * Mimics the real PdfViewer's settled layout — the first page drawn FillWidth edge-to-edge, cleared
 * by the status bar + floating toolbar at the top — using the rendered thumbnail, so the true first
 * page fades in exactly over it once decoded, with no layout shift.
 */
@Composable
private fun PdfPageStandIn(document: DocumentDto, modifier: Modifier = Modifier) {
    val topInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + VIEWER_TOOLBAR_INSET
    Box(
        modifier
            .background(MaterialTheme.colorScheme.background)
            .padding(top = topInset),
    ) {
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(ThumbnailRef(document.id, ThumbnailSize.LG))
                .memoryCacheKey(thumbnailMemoryCacheKey(document.id, ThumbnailSize.LG))
                // The grid's bitmap shows instantly while LG loads — no blank box mid-morph.
                .placeholderMemoryCacheKey(thumbnailMemoryCacheKey(document.id, GRID_THUMBNAIL_SIZE))
                .build(),
            contentDescription = document.original_filename,
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

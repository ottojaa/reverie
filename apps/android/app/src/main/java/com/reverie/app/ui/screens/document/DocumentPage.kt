package com.reverie.app.ui.screens.document

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.DocumentViewerBody
import com.reverie.app.ui.screens.viewer.isImageDocument
import com.reverie.app.ui.screens.viewer.viewers.DocumentDiveHero

/**
 * One page of the swipe viewer: a single document's hero + real viewer, for [id]. Mirrors the old
 * single-document [DocumentScreen] body — including the image-only aspect box that the container
 * transform grows into — but is parameterized by id so the pager can host many.
 *
 * The shared-element ([documentSharedBounds]) is applied only to the **current** page: at nav
 * enter/pop the pager's current page is the entry/target document, so only it morphs from/to the
 * grid tile; neighbor pages (composed by [beyondViewportPageCount]) would otherwise falsely match a
 * grid tile of the same id and animate off-screen.
 */
@Composable
fun DocumentPage(
    id: String,
    aspectHint: Float?,
    isCurrentPage: Boolean,
    isSettledPage: Boolean,
    onToggleImmersive: () -> Unit,
    onDownloadStarted: () -> Unit,
    viewModel: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val document by viewModel.observeDocument(id).collectAsStateWithLifecycle(initialValue = null)
    // Signed URLs are stripped from the cache; fetch (once, cached) when this page enters composition.
    // The pager only composes the current page ± beyondViewportPageCount, so only nearby pages fetch.
    val fileUrl by produceState<String?>(initialValue = null, id) { value = viewModel.fileUrl(id) }

    BoxWithConstraints(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        // Only images fit themselves into an aspect-matched box (the dive-transform target); every
        // other viewer wants the full screen. Prefer the nav-arg aspect on the entry page (known on
        // frame 1) so the shared bounds never change shape mid-transition.
        val isImage = document?.let(::isImageDocument) ?: true
        val effectiveAspect = if (isImage) aspectHint ?: document?.mediaAspectOrNull() else null
        val screenAspect = maxWidth.value / maxHeight.value
        val heroBounds = when {
            effectiveAspect == null -> Modifier.fillMaxSize()
            effectiveAspect >= screenAspect -> Modifier.fillMaxWidth().aspectRatio(effectiveAspect)
            else -> Modifier.fillMaxHeight().aspectRatio(effectiveAspect, matchHeightConstraintsFirst = true)
        }
        val bounds = if (isCurrentPage) heroBounds.documentSharedBounds(id) else heroBounds
        Box(bounds) {
            // Base layer: the thumbnail hero (present from frame 1). Real content draws on top.
            DocumentDiveHero(id, Modifier.fillMaxSize())
            document?.let { doc ->
                DocumentViewerBody(
                    document = doc,
                    fileUrl = fileUrl,
                    loadFile = { viewModel.originalFile(id) },
                    onToggleImmersive = onToggleImmersive,
                    onDownload = { if (downloadDocument(context, fileUrl, doc)) onDownloadStarted() },
                    isSettledPage = isSettledPage,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

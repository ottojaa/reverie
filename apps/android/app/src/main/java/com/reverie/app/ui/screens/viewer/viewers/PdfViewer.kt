package com.reverie.app.ui.screens.viewer.viewers

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.min

/** Renders a PDF (from the on-disk cache) as a vertically-scrolling, pinch-zoomable list of pages. */
@Composable
fun PdfViewer(
    loadFile: suspend (onProgress: (Float) -> Unit) -> File,
    modifier: Modifier = Modifier,
    // Disabled while the details pane is open so the page list doesn't steal the drag-to-close.
    scrollEnabled: Boolean = true,
    // Tap toggles the viewer chrome — PDFs open full-screen (chrome hidden), so this brings it back.
    onTap: () -> Unit = {},
) {
    var pages by remember { mutableStateOf<List<Bitmap>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Float?>(null) }

    LaunchedEffect(Unit) {
        runCatching {
            val file = loadFile { progress = it }
            withContext(Dispatchers.IO) { renderPdf(file, RENDER_WIDTH) }
        }.onSuccess { pages = it }.onFailure { failed = true }
    }

    // PDFs open full-screen (see DocumentScreen), so pages fill the width edge-to-edge and only clear
    // the status bar at the top — the toolbar, when tapped back in, floats over the first page. The
    // dive stand-in (PdfPageStandIn) mirrors these insets so the real pages land on it with no shift.
    val topInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    ViewerContent(
        value = pages,
        failed = failed,
        failureText = "Couldn't open this PDF",
        progress = progress,
        modifier = modifier,
    ) { loaded ->
        PdfPageList(pages = loaded, topInset = topInset, scrollEnabled = scrollEnabled, onTap = onTap)
    }
}

/**
 * The page list with pinch-to-zoom. A two-finger pinch zooms up to [MAX_SCALE]; the list keeps its
 * native vertical scroll at every zoom level, so you can scroll through all pages while magnified,
 * and single-finger horizontal drags pan the widened page. Because a graphicsLayer scale doesn't
 * grow the scroll range, extra bottom room is added so the document's tail stays reachable when
 * zoomed. Zoom resets when gestures are handed off — the details pane opening disables [scrollEnabled].
 */
@Composable
private fun PdfPageList(pages: List<Bitmap>, topInset: Dp, scrollEnabled: Boolean, onTap: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(scrollEnabled) {
        if (!scrollEnabled) {
            scale = 1f
            offsetX = 0f
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val viewportPx = constraints.maxHeight.toFloat()
        // A graphicsLayer scale magnifies without extending the scroll range, so the tail would clip;
        // this extra bottom padding restores just enough scroll room to reach it at the current zoom.
        val extraBottom = with(LocalDensity.current) { (viewportPx * (scale - 1f) / scale).toDp() }

        // Opaque backdrop so the dive-hero thumbnail (drawn beneath every viewer for the container
        // transform) doesn't bleed through the page gaps/padding once pages render.
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                // Gestures sit OUTSIDE the graphicsLayer so their deltas are in screen space (1:1 pan),
                // and the pinch is claimed before the list's own scroll (see detectPinchZoom).
                // Tap toggles the chrome; only while scroll is live (the details pane owns taps then).
                .pointerInput(scrollEnabled) { if (scrollEnabled) detectTapGestures { onTap() } }
                .pointerInput(scrollEnabled) {
                    if (!scrollEnabled) return@pointerInput
                    detectPinchZoom(scale = { scale }, offsetX = { offsetX }) { s, x -> scale = s; offsetX = x }
                }
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offsetX
                    // Anchor the top so scrolling still reaches page 1; the extra bottom padding covers
                    // the tail. Horizontal scale stays centred so left/right pan is symmetric.
                    transformOrigin = TransformOrigin(0.5f, 0f)
                    // Clip the widened page to the viewport so it never bleeds onto the pager neighbours.
                    clip = true
                },
            contentPadding = PaddingValues(top = topInset, bottom = 12.dp + extraBottom),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            userScrollEnabled = scrollEnabled,
        ) {
            items(pages) { bitmap ->
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(androidx.compose.ui.graphics.Color.White),
                )
            }
        }
    }
}

/**
 * Pinch-to-zoom / horizontal-pan detector that coexists with the list's native scroll. A two-finger
 * pinch is consumed to drive the zoom (so the list doesn't scroll mid-pinch). A single-finger drag is
 * left UNCONSUMED so vertical movement still reaches the LazyColumn (scroll through pages while
 * zoomed); its horizontal component pans the magnified page, clamped so it can't cross the edges.
 */
private suspend fun PointerInputScope.detectPinchZoom(
    scale: () -> Float,
    offsetX: () -> Float,
    onTransform: (Float, Float) -> Unit,
) {
    awaitEachGesture {
        // Initial pass throughout so a two-finger pinch is claimed before the list's scroll reacts;
        // single-finger drags are left unconsumed so vertical scrolling still reaches the list.
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val pinch = event.changes.count { it.pressed } >= 2
            if (pinch) {
                val newScale = (scale() * event.calculateZoom()).coerceIn(1f, MAX_SCALE)
                val newX = if (newScale <= 1f) 0f else clampX(offsetX() + event.calculatePan().x, newScale, size.width)
                onTransform(newScale, newX)
                event.changes.forEach { it.consume() }
            } else if (scale() > 1f) {
                val panX = event.calculatePan().x
                // Pan horizontally; leave the event unconsumed so a vertical drag still scrolls the list.
                if (panX != 0f) onTransform(scale(), clampX(offsetX() + panX, scale(), size.width))
            }
        } while (event.changes.any { it.pressed })
    }
}

/** Bound [raw] so the page (widened by [scale] within [width]) can't be panned past its side edges. */
private fun clampX(raw: Float, scale: Float, width: Int): Float {
    val maxX = width * (scale - 1f) / 2f
    return raw.coerceIn(-maxX, maxX)
}

private fun renderPdf(file: File, width: Int): List<Bitmap> {
    val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    PdfRenderer(descriptor).use { renderer ->
        val count = min(renderer.pageCount, MAX_PAGES)
        return (0 until count).map { index ->
            renderer.openPage(index).use { page ->
                val height = (width.toFloat() / page.width * page.height).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bitmap
            }
        }
    }
}

private const val RENDER_WIDTH = 1240
private const val MAX_PAGES = 60
private const val MAX_SCALE = 4f

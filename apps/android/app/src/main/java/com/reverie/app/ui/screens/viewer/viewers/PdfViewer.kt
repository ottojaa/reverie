package com.reverie.app.ui.screens.viewer.viewers

import android.graphics.Bitmap
import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.AnimationVector
import androidx.compose.animation.core.DecayAnimationSpec
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.tween
import androidx.compose.animation.splineBasedDecay
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Renders a PDF (from the on-disk cache) as a vertically-scrolling, pinch-zoomable list of pages. */
@Composable
fun PdfViewer(
    loadFile: suspend (onProgress: (Float) -> Unit) -> File,
    modifier: Modifier = Modifier,
    // Disabled while the details pane is open so the page list doesn't steal the drag-to-close.
    scrollEnabled: Boolean = true,
    // Tap toggles the viewer chrome, mirroring the image viewer.
    onTap: () -> Unit = {},
    // Reports the zoomed-in state so the chrome hides and the details drawer stays put (see DocumentScreen).
    onZoomChanged: (Boolean) -> Unit = {},
) {
    var doc by remember { mutableStateOf<PdfPages?>(null) }
    var failed by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Float?>(null) }

    LaunchedEffect(Unit) {
        var opened: PdfPages? = null
        try {
            val file = loadFile { progress = it }
            withContext(Dispatchers.IO) { opened = PdfPages(file) }
            doc = opened
        } catch (e: Throwable) {
            // Cancellation can land after the renderer opened but before it reached state — close
            // the orphan either way, then let real failures fall through to the error text.
            opened?.closeAsync()
            if (e is CancellationException) throw e
            failed = true
        }
    }
    DisposableEffect(doc) {
        val current = doc
        onDispose { current?.closeAsync() }
    }

    // Clear the status bar + the floating viewer toolbar so the first page isn't hidden beneath them.
    val topInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + VIEWER_TOOLBAR_INSET
    ViewerContent(
        value = doc,
        failed = failed,
        failureText = "Couldn't open this PDF",
        progress = progress,
        modifier = modifier,
    ) { loaded ->
        PdfPageList(loaded, topInset, scrollEnabled, onTap = onTap, onZoomChanged = onZoomChanged)
    }
}

/**
 * The zoomable page list. The vertical axis is the LazyColumn's own scroll at every zoom level, so
 * every page of the document stays reachable while magnified; the zoom itself is a graphicsLayer
 * scale about the top-left corner with a clamped horizontal translation, and [PdfZoomState] keeps
 * the two in sync so a pinch zooms about the fingers and a pan tracks them 1:1 on both axes.
 * Because a layer scale doesn't grow the scroll range, extra bottom padding restores just enough
 * room to reach the document's tail at the current zoom.
 */
@Composable
private fun PdfPageList(
    doc: PdfPages,
    topInset: Dp,
    scrollEnabled: Boolean,
    onTap: () -> Unit,
    onZoomChanged: (Boolean) -> Unit,
) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val decay = remember(density) { splineBasedDecay<Offset>(density) }
    val zoom = remember(listState, decay) { PdfZoomState(listState, scope, decay) }

    // The details pane taking over (scrollEnabled=false) hands gestures off — drop the zoom with it.
    LaunchedEffect(scrollEnabled) { if (!scrollEnabled) zoom.reset() }
    LaunchedEffect(zoom.isZoomed) { onZoomChanged(zoom.isZoomed) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        zoom.viewportWidth = constraints.maxWidth
        val viewportPx = constraints.maxHeight.toFloat()
        // A graphicsLayer scale magnifies without extending the scroll range, so the tail would clip;
        // this extra bottom padding restores just enough scroll room to reach it at the current zoom.
        val extraBottom = with(density) { (viewportPx * (zoom.scale - 1f) / zoom.scale).toDp() }

        // Opaque backdrop so the dive-hero thumbnail (drawn beneath every viewer for the container
        // transform) doesn't bleed through the page gaps/padding once pages render.
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                // Gesture handlers sit OUTSIDE the scale layer so they see raw screen-space deltas.
                .pointerInput(scrollEnabled) {
                    if (!scrollEnabled) return@pointerInput
                    detectTapGestures(
                        onTap = { onTap() },
                        onDoubleTap = { zoom.animateDoubleTapZoom(it) },
                    )
                }
                .pointerInput(scrollEnabled) { if (scrollEnabled) detectZoomGestures(zoom) }
                .graphicsLayer {
                    scaleX = zoom.scale
                    scaleY = zoom.scale
                    translationX = zoom.translationX
                    // Top-left anchor keeps the layer math one-to-one with the list's own scroll;
                    // clip so the magnified page never bleeds onto the pager neighbours.
                    transformOrigin = TransformOrigin(0f, 0f)
                    clip = true
                },
            contentPadding = PaddingValues(top = topInset, bottom = 12.dp + extraBottom),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            userScrollEnabled = scrollEnabled,
        ) {
            items(count = doc.pageCount, key = { it }) { index -> PdfPageItem(doc, index) }
            if (doc.isTruncated) {
                item(key = "truncated") {
                    Text(
                        text = "Showing the first ${doc.pageCount} pages",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                    )
                }
            }
        }
    }
}

/** One page: an aspect-true white placeholder that fills with the lazily-rendered bitmap. */
@Composable
private fun PdfPageItem(doc: PdfPages, index: Int) {
    val bitmap by produceState<Bitmap?>(initialValue = null, doc, index) {
        value = withContext(Dispatchers.IO) { doc.render(index) }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(doc.aspects[index])
            .background(Color.White),
    ) {
        bitmap?.let {
            Image(
                bitmap = it.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/**
 * Pinch/pan detector that coexists with the list's native scroll. Unzoomed, it only watches for a
 * second finger, so scrolling, taps and pager swipes stay fully native. A pinch — and, while
 * zoomed, any single-finger drag past touch slop — is claimed on the Initial pass and consumed
 * outright. Without that, drags reached the scaled list (whose pointer space divides by the zoom,
 * so its effective touch slop and fling velocity were scale× worse — the "slow pan") and leaked to
 * ancestors with unscaled slop that won the race (the details drawer popping open mid-pan).
 * Claimed pans track the finger 1:1 on both axes and continue with a decay fling on release.
 */
private suspend fun PointerInputScope.detectZoomGestures(zoom: PdfZoomState) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        zoom.stopMotion()
        val velocity = VelocityTracker()
        var claimed = false
        var preSlopDrag = Offset.Zero
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val pressed = event.changes.filter { it.pressed }
            if (pressed.isEmpty()) break
            if (pressed.size >= 2) {
                claimed = true
                velocity.resetTracking()
                zoom.pinch(event.calculateZoom(), event.calculateCentroid(), event.calculatePan())
                event.changes.forEach { it.consume() }
            } else if (zoom.isZoomed) {
                if (!claimed) {
                    preSlopDrag += event.calculatePan()
                    claimed = preSlopDrag.getDistance() > viewConfiguration.touchSlop
                }
                if (claimed) {
                    zoom.panBy(event.calculatePan())
                    velocity.addPosition(pressed.first().uptimeMillis, pressed.first().position)
                    event.changes.forEach { it.consume() }
                }
            }
        }
        if (claimed && zoom.isZoomed) zoom.fling(velocity.calculateVelocity())
    }
}

/**
 * Zoom/pan state for the PDF page list. The vertical axis rides the LazyColumn's own scroll — in
 * list space, so screen deltas divide by [scale] (the layer magnifies them back) — while the
 * horizontal axis is a clamped layer translation. Both update together from the focal-point math,
 * so the content under the fingers stays under the fingers.
 */
private class PdfZoomState(
    private val listState: LazyListState,
    private val scope: CoroutineScope,
    private val decay: DecayAnimationSpec<Offset>,
) {
    var scale by mutableFloatStateOf(1f)
        private set
    var translationX by mutableFloatStateOf(0f)
        private set
    var viewportWidth = 0

    private var motionJob: Job? = null

    val isZoomed: Boolean get() = scale > 1f

    /** Interrupt any fling / double-tap animation — a new touch takes over. */
    fun stopMotion() {
        motionJob?.cancel()
    }

    /** Rescale about [centroid] and carry the fingers' [pan], keeping the pinched content under them. */
    fun pinch(zoomChange: Float, centroid: Offset, pan: Offset) {
        val newScale = (scale * zoomChange).coerceIn(1f, MAX_SCALE)
        translationX = clampTranslationX(centroid.x + pan.x - (centroid.x - translationX) / scale * newScale, newScale)
        listState.dispatchRawDelta(centroid.y / scale - (centroid.y + pan.y) / newScale)
        scale = newScale
    }

    /** Pan by a screen-space [delta], 1:1 with the finger on both axes. */
    fun panBy(delta: Offset) {
        translationX = clampTranslationX(translationX + delta.x, scale)
        listState.dispatchRawDelta(-delta.y / scale)
    }

    /** Continue a released pan with a decaying fling. */
    fun fling(velocity: Velocity) {
        motionJob = scope.launch {
            var last = Offset.Zero
            AnimationState(
                typeConverter = Offset.VectorConverter,
                initialValue = Offset.Zero,
                initialVelocityVector = AnimationVector(velocity.x, velocity.y),
            ).animateDecay(decay) {
                panBy(value - last)
                last = value
            }
        }
    }

    /** Double-tap: animate between 1× and [DOUBLE_TAP_SCALE], zooming about the tapped point. */
    fun animateDoubleTapZoom(at: Offset) {
        stopMotion()
        val fromScale = scale
        val target = if (isZoomed) 1f else DOUBLE_TAP_SCALE
        motionJob = scope.launch {
            val contentX = (at.x - translationX) / fromScale
            var scrolled = 0f
            animate(fromScale, target, animationSpec = tween(DOUBLE_TAP_ZOOM_MS)) { s, _ ->
                translationX = clampTranslationX(at.x - contentX * s, s)
                val toScroll = at.y / fromScale - at.y / s
                listState.dispatchRawDelta(toScroll - scrolled)
                scrolled = toScroll
                scale = s
            }
        }
    }

    fun reset() {
        stopMotion()
        scale = 1f
        translationX = 0f
    }

    /** The page (widened past the viewport by scale) pans only until its side edges meet the screen's. */
    private fun clampTranslationX(raw: Float, scale: Float): Float =
        raw.coerceIn(-(viewportWidth * (scale - 1f)), 0f)
}

private const val MAX_SCALE = 4f
private const val DOUBLE_TAP_SCALE = 2.5f
private const val DOUBLE_TAP_ZOOM_MS = 220

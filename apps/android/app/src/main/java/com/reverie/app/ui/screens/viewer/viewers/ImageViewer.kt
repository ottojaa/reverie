package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.ScaleFactor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.util.lerp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.ui.navigation.LocalSharedTransitionScope
import com.reverie.app.ui.navigation.MotionTuning
import me.saket.telephoto.zoomable.coil.ZoomableAsyncImage
import kotlin.math.pow

/**
 * Full-resolution image with pinch-zoom/pan; tap toggles the immersive toolbar. Until the signed
 * URL arrives (it's never cached), the grid's already-decoded thumbnail is shown from the memory
 * cache, so the container transform lands on a real image instead of a blank frame.
 *
 * During the open container transform the thumbnail is drawn with a Crop→Fit morph so it starts
 * filling the (cropped) grid tile and smoothly opens to a letterboxed fit — matching Google Photos
 * and avoiding the crop-vs-fit "growing shadow" mismatch. The morph is FRONT-LOADED (see
 * [MORPH_LEAD_EXP]): it reaches Fit well before the bounds finish expanding, otherwise a landscape
 * image — whose Crop scale in a near-fullscreen box is far larger than its Fit scale — balloons
 * past its final size around the mid-point and then visibly shrinks. The zoomable image mounts once
 * the transform settles (and then stays mounted, so the close transform doesn't flicker back).
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun ImageViewer(
    fileUrl: String?,
    documentId: String,
    hasThumbnail: Boolean,
    contentDescription: String,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val transitionActive = LocalSharedTransitionScope.current?.isTransitionActive == true

    // Morph crop→fit over the dive duration, but only while a transform is actually running. If the
    // viewer first composes with no active transform (image already loaded / transform finished),
    // start settled at Fit so there's no stray zoom.
    val morph = remember { Animatable(if (transitionActive) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (transitionActive) {
            val spec = MotionTuning.spec
            morph.animateTo(1f, tween(spec.diveMs, easing = spec.diveEasing.toEasing()))
        }
    }

    // Latch the zoomable image once it's ready and the transform has settled; keep it thereafter.
    var zoomableShown by remember { mutableStateOf(false) }
    if (fileUrl != null && !transitionActive) zoomableShown = true

    when {
        fileUrl != null && zoomableShown -> ZoomableAsyncImage(
            model = ImageRequest.Builder(context)
                .data(fileUrl)
                .apply {
                    if (hasThumbnail) placeholderMemoryCacheKey(thumbnailMemoryCacheKey(documentId, GRID_THUMBNAIL_SIZE))
                }
                .build(),
            contentDescription = contentDescription,
            modifier = modifier.fillMaxSize(),
            onClick = { onTap() },
        )
        hasThumbnail -> AsyncImage(
            model = ImageRequest.Builder(context)
                .data(ThumbnailRef(documentId, GRID_THUMBNAIL_SIZE))
                .memoryCacheKey(thumbnailMemoryCacheKey(documentId, GRID_THUMBNAIL_SIZE))
                .build(),
            contentDescription = contentDescription,
            // Front-load the morph toward Fit so the image never overshoots its final size while the
            // bounds are still growing (see MORPH_LEAD_EXP + the class-level note).
            contentScale = MorphContentScale(morph.value.pow(MORPH_LEAD_EXP)),
            modifier = modifier.fillMaxSize(),
        )
        else -> Box(modifier.fillMaxSize())
    }
}

// Exponent (<1) applied to the linear transform progress to advance the Crop→Fit morph ahead of the
// bounds growth. ~0.3 keeps typical landscape (4:3, 16:9) monotonic — the drawn image approaches its
// final letterboxed size from below instead of overshooting it. Smaller = more front-loaded.
private const val MORPH_LEAD_EXP = 0.3f

/**
 * A [ContentScale] that interpolates between Crop (fraction 0) and Fit (fraction 1). ContentScale
 * can't be lerped directly, but its computed [ScaleFactor] can.
 */
private class MorphContentScale(private val fraction: Float) : ContentScale {
    override fun computeScaleFactor(srcSize: Size, dstSize: Size): ScaleFactor {
        val crop = ContentScale.Crop.computeScaleFactor(srcSize, dstSize)
        val fit = ContentScale.Fit.computeScaleFactor(srcSize, dstSize)
        return ScaleFactor(
            lerp(crop.scaleX, fit.scaleX, fraction),
            lerp(crop.scaleY, fit.scaleY, fraction),
        )
    }
}

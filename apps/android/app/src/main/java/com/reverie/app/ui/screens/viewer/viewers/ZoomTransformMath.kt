package com.reverie.app.ui.screens.viewer.viewers

/**
 * The `graphicsLayer` values (scale + translation, applied about origin `0,0`) that make a
 * full-screen, [ContentScale.Fit][androidx.compose.ui.layout.ContentScale]-drawn thumbnail land
 * exactly where telephoto draws the zoomable content.
 */
data class BaseLayerTransform(
    val scaleX: Float,
    val scaleY: Float,
    val translationX: Float,
    val translationY: Float,
) {
    companion object {
        val Identity = BaseLayerTransform(scaleX = 1f, scaleY = 1f, translationX = 0f, translationY = 0f)
    }
}

/**
 * Re-express telephoto's content transform for the ImageViewer's base thumbnail layer.
 *
 * The base layer is a viewport-sized node that draws the (lower-res) thumbnail with
 * `ContentScale.Fit`. telephoto's [contentTransformation][me.saket.telephoto.zoomable.ZoomableContentTransformation]
 * — computed against a `unscaledAndTopLeftAligned(contentSize)` content location, the SAME location
 * `SubSamplingImage` uses — maps a raw content pixel `(px, py)` to the viewport as
 * `px * scale + offset` about origin `(0, 0)`. `SubSamplingImage` positions its tiles with that exact
 * formula, so reproducing it here keeps the blurry base and the crisp tiles pixel-aligned.
 *
 * The thumbnail is pre-placed by `Fit` at `fitScale = min(vp/content)` and centered, so a raw pixel
 * `(px, py)` sits at node-local `(px*fitScale + fitOffset)`. We solve for the layer transform `g` such
 * that `g(fitPlacement(px,py)) == px*scale + offset`, giving `g.scale = scale / fitScale` and
 * `g.translation = offset - fitOffset * g.scale`.
 *
 * Key properties (why this is robust): at the resting fit, telephoto's `scale == fitScale` and its
 * `offset == fitOffset`, so `g` is the **identity** — pixel-identical to the dive hero. When the
 * transform is unspecified (not laid out yet) or inputs are degenerate, we also return **identity**.
 * Every state therefore degrades to "thumbnail at its fit position", never to a giant or collapsed
 * layer — the giant/black frames the earlier real-pixel-sized base layer produced are impossible here.
 *
 * All inputs are primitives so this is unit-testable without Compose/Android types.
 *
 * @param specified telephoto's `contentTransformation.isSpecified`.
 * @param scaleX/scaleY telephoto's `contentTransformation.scale` (raw-pixel → viewport).
 * @param offsetX/offsetY telephoto's `contentTransformation.offset` (px).
 * @param contentWidth/contentHeight the image's real pixel size.
 * @param viewportWidth/viewportHeight the base layer's (full-screen) pixel size.
 */
fun baseLayerTransform(
    specified: Boolean,
    scaleX: Float,
    scaleY: Float,
    offsetX: Float,
    offsetY: Float,
    contentWidth: Float,
    contentHeight: Float,
    viewportWidth: Float,
    viewportHeight: Float,
): BaseLayerTransform {
    if (!specified) return BaseLayerTransform.Identity
    if (contentWidth <= 0f || contentHeight <= 0f || viewportWidth <= 0f || viewportHeight <= 0f) {
        return BaseLayerTransform.Identity
    }
    val fitScale = minOf(viewportWidth / contentWidth, viewportHeight / contentHeight)
    if (fitScale <= 0f) return BaseLayerTransform.Identity

    val fitOffsetX = (viewportWidth - contentWidth * fitScale) / 2f
    val fitOffsetY = (viewportHeight - contentHeight * fitScale) / 2f
    val relScaleX = scaleX / fitScale
    val relScaleY = scaleY / fitScale
    return BaseLayerTransform(
        scaleX = relScaleX,
        scaleY = relScaleY,
        translationX = offsetX - fitOffsetX * relScaleX,
        translationY = offsetY - fitOffsetY * relScaleY,
    )
}

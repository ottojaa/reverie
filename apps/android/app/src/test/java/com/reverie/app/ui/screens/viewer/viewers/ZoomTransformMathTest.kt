package com.reverie.app.ui.screens.viewer.viewers

import org.junit.Assert.assertEquals
import org.junit.Test

class ZoomTransformMathTest {
    /**
     * The base layer draws the thumbnail Fit-placed, then applies the returned graphicsLayer (origin
     * 0,0). This reproduces that: a raw content pixel lands at `raw*fitScale + fitOffset` (Fit), then
     * `local*g.scale + g.translation` (the layer). It MUST equal telephoto's `raw*scale + offset`.
     */
    private fun assertMapsLikeTelephoto(
        scaleX: Float,
        scaleY: Float,
        offsetX: Float,
        offsetY: Float,
        cw: Float,
        ch: Float,
        vw: Float,
        vh: Float,
    ) {
        val g = baseLayerTransform(true, scaleX, scaleY, offsetX, offsetY, cw, ch, vw, vh)
        val fitScale = minOf(vw / cw, vh / ch)
        val fitOffsetX = (vw - cw * fitScale) / 2f
        val fitOffsetY = (vh - ch * fitScale) / 2f
        // Sample the four corners and the center of the raw content.
        for (px in listOf(0f, cw / 2f, cw)) {
            for (py in listOf(0f, ch / 2f, ch)) {
                val localX = px * fitScale + fitOffsetX
                val localY = py * fitScale + fitOffsetY
                val screenX = localX * g.scaleX + g.translationX
                val screenY = localY * g.scaleY + g.translationY
                assertEquals(px * scaleX + offsetX, screenX, 0.01f)
                assertEquals(py * scaleY + offsetY, screenY, 0.01f)
            }
        }
    }

    @Test
    fun `identity at resting fit — wide panorama`() {
        // Panorama 4096x1856 into a 1264x2780 portrait viewport. At rest telephoto emits scale=fitScale,
        // offset=centering — the base layer must be the identity so it sits exactly on the dive hero.
        val fitScale = minOf(1264f / 4096f, 2780f / 1856f)
        val restOffsetY = (2780f - 1856f * fitScale) / 2f
        val g = baseLayerTransform(true, fitScale, fitScale, 0f, restOffsetY, 4096f, 1856f, 1264f, 2780f)
        assertEquals(1f, g.scaleX, 1e-4f)
        assertEquals(1f, g.scaleY, 1e-4f)
        assertEquals(0f, g.translationX, 1e-3f)
        assertEquals(0f, g.translationY, 1e-3f)
    }

    @Test
    fun `maps like telephoto under a synthetic zoom — width-bound panorama`() {
        // Arbitrary zoomed-in transform (scale/offset need not be a real telephoto state).
        assertMapsLikeTelephoto(0.6f, 0.6f, -200f, 500f, 4096f, 1856f, 1264f, 2780f)
    }

    @Test
    fun `maps like telephoto under a synthetic zoom — height-bound portrait`() {
        // Tall image letterboxed horizontally (non-zero fitOffsetX path).
        assertMapsLikeTelephoto(1.2f, 1.2f, 300f, -100f, 1000f, 3000f, 1264f, 2780f)
    }

    @Test
    fun `unspecified transform yields identity`() {
        val g = baseLayerTransform(false, 0f, 0f, 0f, 0f, 4096f, 1856f, 1264f, 2780f)
        assertEquals(BaseLayerTransform.Identity, g)
    }

    @Test
    fun `degenerate sizes yield identity`() {
        assertEquals(BaseLayerTransform.Identity, baseLayerTransform(true, 1f, 1f, 0f, 0f, 0f, 100f, 100f, 100f))
        assertEquals(BaseLayerTransform.Identity, baseLayerTransform(true, 1f, 1f, 0f, 0f, 100f, 100f, 0f, 100f))
    }
}

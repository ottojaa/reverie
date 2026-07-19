package com.reverie.app.ui.components

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Geometry contract for the quilted ("mosaic") Files grid packer. These guard the Google-Photos-style
 * properties: every tile snaps to one fixed cell size, rows fill the width, panoramas span full width
 * at one cell of height, feature blocks are a clean 2×2 + fillers, features stay occasional and
 * alternate sides, and packing is prefix-stable (so pagination never reshuffles bands on screen).
 */
class MosaicGridTest {

    private val width = 400f
    private val targetCell = 125f
    private val gap = 2f
    private val eps = 0.5f

    // width 400 / targetCell 125 -> 3 columns; cell = (400 - 2*2) / 3 = 132.
    private val columns = 3
    private val cell = (width - (columns - 1) * gap) / columns
    private val featureEdge = 2f * cell + gap

    private fun doc(
        id: String,
        w: Int? = null,
        h: Int? = null,
        hasThumbnail: Boolean = true,
    ): DocumentDto = DocumentDto(
        id = id,
        file_path = "/$id",
        file_hash = id,
        original_filename = "$id.jpg",
        mime_type = "image/jpeg",
        size_bytes = 1,
        width = w,
        height = h,
        thumbnail_blurhash = if (hasThumbnail) "LKO2?U%2Tw=w]~RBVZRi};RPxuwH" else null,
        ocr_status = JobStatus.COMPLETE,
        thumbnail_status = JobStatus.COMPLETE,
        llm_status = JobStatus.COMPLETE,
        is_private = false,
        created_at = "2024-01-01T00:00:00Z",
        updated_at = "2024-01-01T00:00:00Z",
    )

    /** No dimensions and (optionally) no thumbnail — never a panorama or a feature, always a 1×1 cell. */
    private fun plain(id: String) = doc(id, w = null, h = null, hasThumbnail = false)

    /** Portrait photo — a 1×1 cell, but also a valid feature/filler (it has real dims + a thumbnail). */
    private fun portrait(id: String) = doc(id, w = 800, h = 1200)

    /** Landscape with a real thumbnail — a valid 2×2 feature candidate. */
    private fun landscape(id: String) = doc(id, w = 1500, h = 1000)

    /** Ultra-wide panorama — always its own full-width band. */
    private fun panorama(id: String) = doc(id, w = 3000, h = 600)

    private fun sections(docs: List<DocumentDto>) = computeMosaicSections(docs, width, targetCell, gap)

    @Test
    fun `plain rows fill the width with uniform square cells`() {
        // Non-dimensioned files never feature and never span, so the grid is pure 1×1 rows.
        val docs = List(7) { plain("p$it") }
        val result = sections(docs)
        // 7 portraits over 3 columns -> two full rows of 3 + a trailing row of 1.
        val rows = result.filterIsInstance<MosaicRow>()
        assertEquals(3, rows.size)
        // Every full row (all but the last) fills the width exactly.
        rows.dropLast(1).forEach { row ->
            assertEquals(columns, row.tiles.size)
            assertEquals(width, row.tiles.sumOf { it.width.toDouble() }.toFloat() + gap * (columns - 1), eps)
        }
        // Every 1×1 cell is the same square, whatever the photo's real aspect.
        result.flatMap { it.tiles }.forEach { tile ->
            assertEquals(cell, tile.width, eps)
            assertEquals(cell, tile.height, eps)
        }
        // The trailing row keeps its natural cell size — not stretched to fill the width.
        val last = rows.last()
        assertEquals(1, last.tiles.size)
        assertEquals(cell, last.tiles.first().width, eps)
    }

    @Test
    fun `a panorama spans the full width at one cell of height`() {
        val docs = listOf(panorama("pano")) + List(6) { portrait("p$it") }
        val wide = sections(docs).first()
        assertTrue(wide is MosaicWide)
        wide as MosaicWide
        assertEquals("pano", wide.tile.doc.id)
        assertEquals(width, wide.tile.width, eps)
        assertEquals(cell, wide.tile.height, eps)
    }

    @Test
    fun `a feature block is a 2x2 tile with fillers, filling a full-width two-row band`() {
        val docs = listOf(landscape("hero"), portrait("a"), portrait("b")) + List(4) { portrait("t$it") }
        val feature = sections(docs).first()
        assertTrue(feature is MosaicFeature)
        feature as MosaicFeature

        // The 2×2 tile spans two cells plus the gap between them, in both dimensions.
        assertEquals(featureEdge, feature.feature.width, eps)
        assertEquals(featureEdge, feature.feature.height, eps)
        // Fillers are plain 1×1 cells; on a 3-column grid that's exactly two, stacked.
        assertEquals(2 * (columns - 2), feature.fillers.size)
        feature.fillers.forEach { assertEquals(cell, it.width, eps); assertEquals(cell, it.height, eps) }
        // Feature + gap + one filler column fill the width; the band is featureEdge tall, and the
        // stacked fillers (cell + gap + cell) match that height.
        assertEquals(width, feature.feature.width + gap + feature.fillers.first().width, eps)
        assertEquals(featureEdge, cell + gap + cell, eps)
        // First feature sits on the left.
        assertTrue(feature.featureOnLeft)
    }

    @Test
    fun `features stay occasional and alternate sides`() {
        // A long run of feature-eligible photos: a feature recurs on cadence, spaced by plain rows.
        val docs = List(40) { landscape("l$it") }
        val result = sections(docs)
        val features = result.filterIsInstance<MosaicFeature>()
        assertTrue("expected multiple features to exercise the cooldown", features.size >= 2)

        var bandsSinceFeature = Int.MAX_VALUE
        var seen = 0
        result.forEach { section ->
            if (section is MosaicFeature) {
                if (seen > 0) assertTrue("feature too soon: $bandsSinceFeature bands", bandsSinceFeature >= FEATURE_COOLDOWN_BANDS_FOR_TEST)
                seen++
                bandsSinceFeature = 0
            } else {
                bandsSinceFeature++
            }
        }
        // Sides alternate: left, right, left, ...
        features.forEachIndexed { index, f -> assertEquals(index % 2 == 0, f.featureOnLeft) }
    }

    @Test
    fun `packing is prefix-stable so pagination never reshuffles rendered bands`() {
        val docs = buildList {
            repeat(6) {
                add(landscape("l$it"))
                add(portrait("p${it}a"))
                add(portrait("p${it}b"))
                add(panorama("pano$it"))
            }
        }
        val full = sections(docs)
        val prefix = sections(docs.take(docs.size - 5))
        val stable = prefix.dropLast(1)
        assertEquals(stable, full.subList(0, stable.size))
    }

    private companion object {
        // Mirrors the packer's private FEATURE_COOLDOWN_BANDS; kept in sync by the cooldown test.
        const val FEATURE_COOLDOWN_BANDS_FOR_TEST = 3
    }
}

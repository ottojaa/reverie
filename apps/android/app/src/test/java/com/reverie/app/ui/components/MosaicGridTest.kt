package com.reverie.app.ui.components

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToInt

/**
 * Geometry contract for the quilted ("mosaic") Files grid packer. Guards the Google-Photos-style
 * properties: a fixed cell grid where most tiles are 1×1, features fill the width, tall tiles are
 * reserved for portraits, and packing is prefix-stable (pagination never reshuffles rendered bands).
 */
class MosaicGridTest {

    private val width = 400f
    private val targetCell = 125f
    private val gap = 2f
    private val eps = 0.5f

    // width 400 / 125 -> 3 columns; cell = (400 - 2*2) / 3 = 132.
    private val columns = 3
    private val cell = (width - (columns - 1) * gap) / columns
    private fun span(n: Int) = n * cell + (n - 1) * gap
    private fun colsForWidth(w: Float) = ((w + gap) / (cell + gap)).roundToInt()

    private fun doc(id: String, w: Int? = null, h: Int? = null, hasThumbnail: Boolean = true): DocumentDto = DocumentDto(
        id = id, file_path = "/$id", file_hash = id, original_filename = "$id.jpg", mime_type = "image/jpeg",
        size_bytes = 1, width = w, height = h,
        thumbnail_blurhash = if (hasThumbnail) "LKO2?U%2Tw=w]~RBVZRi};RPxuwH" else null,
        ocr_status = JobStatus.COMPLETE, thumbnail_status = JobStatus.COMPLETE, llm_status = JobStatus.COMPLETE,
        is_private = false, created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z",
    )

    /** No dimensions and no thumbnail — can never feature, so it's always a 1×1 cell. */
    private fun plain(id: String) = doc(id, w = null, h = null, hasThumbnail = false)
    private fun landscape(id: String) = doc(id, w = 1500, h = 1000) // aspect 1.5
    private fun portrait(id: String) = doc(id, w = 800, h = 1200)   // aspect 0.67

    private fun sections(docs: List<DocumentDto>, every: Int = 3) =
        computeMosaicSections(docs, width, every, targetCell, gap)

    @Test
    fun `non-featureable photos tile as uniform 1x1 rows that fill the width`() {
        val docs = List(7) { plain("p$it") }
        val result = sections(docs, every = 3)
        assertTrue(result.all { it is MosaicRow })
        val rows = result.filterIsInstance<MosaicRow>()
        rows.dropLast(1).forEach { row ->
            assertEquals(columns, row.tiles.size)
            assertEquals(width, row.tiles.sumOf { it.width.toDouble() }.toFloat() + gap * (columns - 1), eps)
        }
        result.flatMap { it.tiles }.forEach { assertEquals(cell, it.width, eps); assertEquals(cell, it.height, eps) }
    }

    @Test
    fun `every feature block fills the full width and its fillers are 1x1 cells`() {
        val docs = List(60) { landscape("l$it") }
        val blocks = sections(docs, every = 2).filterIsInstance<MosaicBlock>()
        assertTrue("expected some feature blocks", blocks.isNotEmpty())
        blocks.forEach { b ->
            val fc = colsForWidth(b.feature.width)
            assertTrue(fc in 1..columns)
            assertTrue(b.blockRows == 2 || b.blockRows == 3)
            assertEquals(span(b.blockRows), b.feature.height, eps)
            // feature columns + filler columns span the whole grid width
            assertEquals(columns, fc + b.fillers.size / b.blockRows)
            b.fillers.forEach { assertEquals(cell, it.width, eps); assertEquals(cell, it.height, eps) }
        }
    }

    @Test
    fun `landscapes never get a tall non-full-width tile`() {
        val docs = List(60) { landscape("l$it") }
        val blocks = sections(docs, every = 2).filterIsInstance<MosaicBlock>()
        blocks.forEach { b ->
            val fc = colsForWidth(b.feature.width)
            // 1×3 / 2×3 (tall AND narrower than full width) are portrait-only.
            assertTrue("landscape got a ${fc}x${b.blockRows} tile", !(b.blockRows == 3 && fc < columns))
        }
    }

    @Test
    fun `portrait features are tall blocks`() {
        val docs = List(60) { portrait("p$it") }
        val blocks = sections(docs, every = 2).filterIsInstance<MosaicBlock>()
        assertTrue("expected portrait feature blocks", blocks.isNotEmpty())
        blocks.forEach { b ->
            val fc = colsForWidth(b.feature.width)
            assertEquals(3, b.blockRows)          // portraits → 3 rows tall
            assertTrue(fc == 1 || fc == 2)        // 1×3 or 2×3, never full width
        }
    }

    @Test
    fun `higher feature-every yields fewer features`() {
        val docs = List(90) { landscape("l$it") }
        val lively = sections(docs, every = 2).count { it is MosaicBlock }
        val calm = sections(docs, every = 10).count { it is MosaicBlock }
        assertTrue("lively=$lively calm=$calm", lively > calm)
    }

    @Test
    fun `packing is prefix-stable so pagination never reshuffles rendered bands`() {
        val docs = buildList {
            repeat(8) {
                add(landscape("l$it")); add(landscape("m$it")); add(portrait("p$it")); add(plain("x$it"))
            }
        }
        val full = sections(docs, every = 3)
        val prefix = sections(docs.take(docs.size - 6), every = 3)
        val stable = prefix.dropLast(1)
        assertEquals(stable, full.subList(0, stable.size))
    }

    @Test
    fun `uniform layout is plain square rows filling the width`() {
        val docs = List(7) { landscape("l$it") }
        val result = computeUniformSections(docs, width, targetCell, gap)
        assertTrue(result.all { it is MosaicRow })
        val rows = result.filterIsInstance<MosaicRow>()
        // 7 docs over 3 columns -> two full rows + a trailing row of one.
        assertEquals(3, rows.size)
        rows.dropLast(1).forEach { assertEquals(columns, it.tiles.size) }
        result.flatMap { it.tiles }.forEach { assertEquals(cell, it.width, eps); assertEquals(cell, it.height, eps) }
    }

    @Test
    fun `justified rows keep natural aspect and fill the width`() {
        val docs = List(12) { landscape("l$it") } // aspect 1.5
        val result = computeJustifiedSections(docs, width, targetRowHeight = 150f, gap = gap)
        val rows = result.filterIsInstance<MosaicRow>()
        assertTrue(rows.isNotEmpty())
        rows.dropLast(1).forEach { row ->
            // A full row fills the width exactly.
            assertEquals(width, row.tiles.sumOf { it.width.toDouble() }.toFloat() + gap * (row.tiles.size - 1), eps)
            // Every tile in a row shares the row height; widths follow the aspect (≈ height * 1.5).
            val h = row.tiles.first().height
            row.tiles.forEach { assertEquals(h, it.height, eps); assertEquals(h * 1.5f, it.width, 2f) }
            // Landscapes are not square — the row is shorter than one tile is wide.
            assertTrue(h < row.tiles.first().width)
        }
    }

    @Test
    fun `justified trailing row is not stretched`() {
        // One landscape can't fill a row, so it keeps the target height rather than ballooning.
        val docs = listOf(landscape("only"))
        val row = computeJustifiedSections(docs, width, targetRowHeight = 150f, gap = gap).single() as MosaicRow
        assertEquals(1, row.tiles.size)
        assertEquals(150f, row.tiles.first().height, eps)
        assertEquals(150f * 1.5f, row.tiles.first().width, eps)
    }
}

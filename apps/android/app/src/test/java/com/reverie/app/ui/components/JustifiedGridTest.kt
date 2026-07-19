package com.reverie.app.ui.components

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Geometry contract for the justified ("mosaic") Files grid packer. These guard the properties the
 * UI relies on: rows fill the width, panoramas stand alone, the trailing row isn't stretched, hero
 * blocks are laid out correctly, heroes stay occasional, and packing is prefix-stable (so pagination
 * never reshuffles sections already on screen).
 */
class JustifiedGridTest {

    private val width = 400f
    private val target = 160f
    private val gap = 2f
    private val eps = 0.5f

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

    /** 3:2 landscape — packs into plain rows, never a hero stack (aspect 1.5 > the stack ceiling). */
    private fun landscape(id: String) = doc(id, w = 1500, h = 1000)

    /** 1:1 square — a valid hero-stack tile but never a hero (aspect below the hero floor). */
    private fun square(id: String) = doc(id, w = 1000, h = 1000)

    /** Ultra-wide panorama — always fills a row on its own (natural width exceeds the screen). */
    private fun panorama(id: String) = doc(id, w = 3000, h = 600)

    private fun MosaicSection.filledWidth(): Float = when (this) {
        is MosaicRow -> tiles.sumOf { it.width.toDouble() }.toFloat() + gap * (tiles.size - 1)
        is MosaicHeroBlock -> hero.width + gap + stack.first().width
    }

    @Test
    fun `full rows fill the available width exactly`() {
        val docs = List(10) { landscape("l$it") }
        val sections = computeMosaicSections(docs, width, target, gap)
        // Every section but the last is closed and must fill the width edge-to-edge.
        sections.dropLast(1).forEach { assertEquals(width, it.filledWidth(), eps) }
    }

    @Test
    fun `a panorama gets its own full-width row`() {
        // A very wide panorama followed by landscapes: the stack ceiling blocks a hero, so the
        // panorama can only land in a row of its own (its natural width already exceeds the screen).
        val docs = listOf(doc("pano", w = 3000, h = 600)) + List(5) { landscape("l$it") }
        val sections = computeMosaicSections(docs, width, target, gap)
        val first = sections.first()
        assertTrue(first is MosaicRow)
        first as MosaicRow
        assertEquals(1, first.tiles.size)
        assertEquals("pano", first.tiles.first().doc.id)
        assertEquals(width, first.tiles.first().width, eps)
        // Aspect clamps to 3.5, so height = width / 3.5.
        assertEquals(width / 3.5f, first.tiles.first().height, eps)
    }

    @Test
    fun `the trailing partial row is not stretched`() {
        // Seven squares pack as rows of three, leaving a lone square that must keep its natural size.
        val docs = List(7) { square("s$it") }
        val sections = computeMosaicSections(docs, width, target, gap)
        val last = sections.last() as MosaicRow
        assertEquals(1, last.tiles.size)
        assertEquals(target, last.tiles.first().height, eps)
        assertEquals(target, last.tiles.first().width, eps) // square at target height, not widened
    }

    @Test
    fun `hero block geometry spans full width and stacks two crop-free tiles`() {
        val docs = listOf(landscape("hero"), square("a"), square("b"))
        val sections = computeMosaicSections(docs, width, target, gap)
        val block = sections.single() as MosaicHeroBlock
        val blockHeight = 2f * target + gap

        assertEquals(blockHeight, block.hero.height, eps)
        assertEquals(2, block.stack.size)
        // Both stacked tiles share the column width.
        assertEquals(block.stack[0].width, block.stack[1].width, eps)
        // The two stacked tiles plus their gap fill the block height.
        assertEquals(blockHeight, block.stack[0].height + gap + block.stack[1].height, eps)
        // Hero + gap + stack column fill the screen width.
        assertEquals(width, block.hero.width + gap + block.stack[0].width, eps)
        // First hero sits on the left; sides alternate thereafter.
        assertTrue(block.heroOnLeft)
    }

    @Test
    fun `hero blocks respect the cooldown between them`() {
        // Each unit is a hero-eligible triple (landscape + two squares) followed by four panoramas
        // that each consume exactly one row — so a hero recurs every unit, spaced by four plain rows.
        val docs = buildList {
            repeat(4) { u ->
                add(landscape("hero$u"))
                add(square("a$u"))
                add(square("b$u"))
                repeat(4) { p -> add(panorama("p$u-$p")) }
            }
        }
        val sections = computeMosaicSections(docs, width, target, gap)

        var rowsSinceHero = Int.MAX_VALUE
        var heroes = 0
        sections.forEach { section ->
            when (section) {
                is MosaicHeroBlock -> {
                    if (heroes > 0) assertTrue("hero too soon: $rowsSinceHero rows", rowsSinceHero >= HERO_COOLDOWN_ROWS_FOR_TEST)
                    heroes++
                    rowsSinceHero = 0
                }
                is MosaicRow -> rowsSinceHero++
            }
        }
        assertTrue("expected multiple hero blocks to exercise the cooldown", heroes >= 2)
    }

    @Test
    fun `packing is prefix-stable so pagination never reshuffles rendered sections`() {
        val docs = buildList {
            repeat(6) {
                add(landscape("l$it"))
                add(square("s${it}a"))
                add(square("s${it}b"))
                add(doc("p$it", w = 800, h = 1200)) // portrait
            }
        }
        val full = computeMosaicSections(docs, width, target, gap)
        val prefix = computeMosaicSections(docs.take(docs.size - 5), width, target, gap)
        // Everything but the prefix's own trailing (possibly-open) section must match the full packing.
        val stable = prefix.dropLast(1)
        assertEquals(stable, full.subList(0, stable.size))
    }

    private companion object {
        // Mirrors the packer's private HERO_COOLDOWN_ROWS; kept in sync by the cooldown test.
        const val HERO_COOLDOWN_ROWS_FOR_TEST = 4
    }
}

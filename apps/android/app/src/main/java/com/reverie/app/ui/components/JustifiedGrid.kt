package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.mediaAspectOrNull
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Google-Photos-style justified ("mosaic") layout for the Files grid. Instead of a uniform column
 * count, tiles keep their real aspect ratio and each row is scaled to fill the width edge-to-edge —
 * wide panoramas become full-width heroes, portraits sit narrow. On top of plain rows the packer
 * occasionally emits a [MosaicHeroBlock]: one double-height tile with two smaller tiles stacked
 * beside it (the signature Google Photos accent).
 *
 * All geometry is in dp. [computeMosaicSections] is a pure function so it can be unit-tested and
 * cheaply re-run on rotation/width change.
 */

/** Hairline gap between tiles, matching the old square grid. */
const val MOSAIC_GAP = 2f

private const val MIN_ASPECT = 0.5f // tallest tile ~1:2 (portraits don't tower)
private const val MAX_ASPECT = 3.5f // widest tile ~3.5:1 (panoramas stay hero-wide, no slivers)
private const val FALLBACK_ASPECT = 1f // non-dimensioned files (apk/zip/audio, still-processing)

private const val HERO_MIN_ASPECT = 1.2f // hero candidate: landscape-ish, with real dims + a thumbnail
private const val HERO_STACK_MAX_ASPECT = 1.15f // stack candidates: square/portrait-ish
private const val HERO_COOLDOWN_ROWS = 4 // >= this many plain rows between hero blocks
private const val HERO_STACK_MIN_WIDTH_FRACTION = 0.28f // no sliver stack
private const val HERO_STACK_MAX_WIDTH_FRACTION = 0.42f // no half-screen stack

/** One tile: the document plus its resolved size in dp. */
data class MosaicTile(val doc: DocumentDto, val width: Float, val height: Float)

/** A packed section of the grid — either a justified row or a hero block. */
sealed interface MosaicSection {
    /** All tiles in document order, so callers can locate a document regardless of section shape. */
    val tiles: List<MosaicTile>
}

/** A single justified row: tile widths vary, one shared height. */
data class MosaicRow(override val tiles: List<MosaicTile>) : MosaicSection

/** One double-height hero tile with two tiles stacked beside it; sides alternate per block. */
data class MosaicHeroBlock(
    val hero: MosaicTile,
    val stack: List<MosaicTile>, // exactly 2, stacked vertically beside the hero
    val heroOnLeft: Boolean,
) : MosaicSection {
    override val tiles: List<MosaicTile> get() = listOf(hero) + stack
}

private fun DocumentDto.clampedAspect(): Float =
    (mediaAspectOrNull() ?: FALLBACK_ASPECT).coerceIn(MIN_ASPECT, MAX_ASPECT)

/**
 * Pack [docs] into rows and the occasional hero block that together fill [availableWidth].
 *
 * The packer is a left-to-right fold whose decision at each position looks only at the current
 * document (and, for a hero, the next two). A row is closed — and never revised — once its natural
 * width reaches [availableWidth], and hero blocks are chosen from a fixed 3-document lookahead, so
 * appending more documents only ever reflows the trailing partial row. That prefix stability is what
 * keeps pagination from reshuffling sections that are already on screen.
 */
fun computeMosaicSections(
    docs: List<DocumentDto>,
    availableWidth: Float,
    targetRowHeight: Float,
    gap: Float = MOSAIC_GAP,
): List<MosaicSection> {
    if (docs.isEmpty() || availableWidth <= 0f || targetRowHeight <= 0f) return emptyList()
    val sections = mutableListOf<MosaicSection>()
    var i = 0
    var rowsSinceHero = HERO_COOLDOWN_ROWS // allow a hero as soon as content permits
    var heroCount = 0
    while (i < docs.size) {
        val hero = tryHeroBlock(docs, i, availableWidth, targetRowHeight, gap, rowsSinceHero, heroCount)
        if (hero != null) {
            sections += hero
            heroCount++
            rowsSinceHero = 0
            i += 3
            continue
        }
        val (row, next) = packRow(docs, i, availableWidth, targetRowHeight, gap)
        sections += row
        rowsSinceHero++
        i = next
    }
    return sections
}

/** Try to form a hero block starting at [start]; null when the guard/shape conditions aren't met. */
private fun tryHeroBlock(
    docs: List<DocumentDto>,
    start: Int,
    availableWidth: Float,
    targetRowHeight: Float,
    gap: Float,
    rowsSinceHero: Int,
    heroCount: Int,
): MosaicHeroBlock? {
    if (rowsSinceHero < HERO_COOLDOWN_ROWS) return null
    if (start + 2 > docs.lastIndex) return null // need three real documents; never from the tail
    val heroDoc = docs[start]
    // A big icon-only tile would read as a broken hero, so require a genuine landscape photo/video.
    if (!heroDoc.hasRenderedThumbnail || heroDoc.mediaAspectOrNull() == null) return null
    if (heroDoc.clampedAspect() < HERO_MIN_ASPECT) return null
    val top = docs[start + 1]
    val bottom = docs[start + 2]
    if (top.clampedAspect() > HERO_STACK_MAX_ASPECT || bottom.clampedAspect() > HERO_STACK_MAX_ASPECT) return null

    val blockHeight = 2f * targetRowHeight + gap
    val stackHeight = blockHeight - gap // two stacked tiles + one gap fill the block height
    val a1 = top.clampedAspect()
    val a2 = bottom.clampedAspect()
    // Column width that would render both stacked tiles crop-free, clamped so the stack is neither a
    // sliver nor half the screen. When clamped, ContentScale.Crop absorbs the small mismatch.
    val stackWidth = (stackHeight / (1f / a1 + 1f / a2))
        .coerceIn(HERO_STACK_MIN_WIDTH_FRACTION * availableWidth, HERO_STACK_MAX_WIDTH_FRACTION * availableWidth)
    val minTile = 0.35f * targetRowHeight
    val topHeight = (stackWidth / a1).coerceIn(minTile, stackHeight - minTile)
    val bottomHeight = stackHeight - topHeight
    val heroWidth = availableWidth - stackWidth - gap
    return MosaicHeroBlock(
        hero = MosaicTile(heroDoc, heroWidth, blockHeight),
        stack = listOf(MosaicTile(top, stackWidth, topHeight), MosaicTile(bottom, stackWidth, bottomHeight)),
        heroOnLeft = heroCount % 2 == 0,
    )
}

/** Greedily accumulate documents into one row and return it plus the next index. */
private fun packRow(
    docs: List<DocumentDto>,
    start: Int,
    availableWidth: Float,
    targetRowHeight: Float,
    gap: Float,
): Pair<MosaicRow, Int> {
    val rowDocs = mutableListOf<DocumentDto>()
    var aspectSum = 0f
    var i = start
    var full = false
    while (i < docs.size) {
        rowDocs += docs[i]
        aspectSum += docs[i].clampedAspect()
        i++
        val naturalWidth = targetRowHeight * aspectSum + gap * (rowDocs.size - 1)
        if (naturalWidth >= availableWidth) {
            full = true
            break
        }
    }
    val tiles = if (full) {
        justifyRow(rowDocs, availableWidth, gap)
    } else {
        // Trailing partial row: keep the target height, natural widths, left-aligned (not stretched).
        rowDocs.map { MosaicTile(it, targetRowHeight * it.clampedAspect(), targetRowHeight) }
    }
    return MosaicRow(tiles) to i
}

/** Scale a full row so its tiles + gaps fill [availableWidth] exactly. */
private fun justifyRow(rowDocs: List<DocumentDto>, availableWidth: Float, gap: Float): List<MosaicTile> {
    val aspectSum = rowDocs.fold(0f) { acc, doc -> acc + doc.clampedAspect() }
    val totalGap = gap * (rowDocs.size - 1)
    val rowHeight = (availableWidth - totalGap) / aspectSum
    var widthUsed = 0f
    return rowDocs.mapIndexed { index, doc ->
        // The last tile absorbs integer-rounding drift so the row fills the width to the pixel.
        val width = if (index == rowDocs.lastIndex) {
            availableWidth - totalGap - widthUsed
        } else {
            (rowHeight * doc.clampedAspect()).also { widthUsed += it }
        }
        MosaicTile(doc, width, rowHeight)
    }
}

/**
 * A justified Files grid: a [LazyColumn] of packed sections. Owns infinite-scroll paging and the
 * return-transform scroll sync (both keyed on sections, not documents) so [BrowseScreen] stays lean.
 */
@Composable
fun MosaicDocumentGrid(
    documents: List<DocumentDto>,
    listState: LazyListState,
    contentPadding: PaddingValues,
    hasMore: Boolean,
    onLoadMore: () -> Unit,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    selected: (DocumentDto) -> Boolean,
    onClick: (DocumentDto) -> Unit,
    onLongClick: (DocumentDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        // ~2–3 tiles per row on a phone; grows on wider screens. Tunable.
        val target = (maxWidth.value / 2.4f).coerceIn(140f, 220f)
        val sections = remember(documents, maxWidth) {
            computeMosaicSections(documents, maxWidth.value, target)
        }

        // Infinite scroll: fetch the next page as the last section approaches.
        LaunchedEffect(listState, hasMore, sections.size) {
            snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
                .distinctUntilChanged()
                .collect { lastIndex -> if (hasMore && lastIndex >= sections.size - 2) onLoadMore() }
        }

        // Return-transform sync: scroll the section holding the focused document into view so the
        // shared-element container transform lands on the right tile when the viewer pops back.
        LaunchedEffect(focusedId, sections) {
            val id = focusedId ?: return@LaunchedEffect
            val index = sections.indexOfFirst { section -> section.tiles.any { it.doc.id == id } }
            if (index < 0) return@LaunchedEffect
            if (listState.layoutInfo.visibleItemsInfo.none { it.index == index }) listState.scrollToItem(index)
            onFocusConsumed()
        }

        LazyColumn(
            state = listState,
            contentPadding = contentPadding,
            verticalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(sections.size, key = { sections[it].tiles.first().doc.id }, contentType = { "section" }) { index ->
                MosaicSectionView(sections[index], selected, onClick, onLongClick)
            }
        }
    }
}

@Composable
private fun MosaicSectionView(
    section: MosaicSection,
    selected: (DocumentDto) -> Boolean,
    onClick: (DocumentDto) -> Unit,
    onLongClick: (DocumentDto) -> Unit,
) {
    when (section) {
        is MosaicRow -> Row(horizontalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
            section.tiles.forEach { tile -> MosaicCard(tile, selected, onClick, onLongClick) }
        }
        is MosaicHeroBlock -> Row(horizontalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
            val stack: @Composable () -> Unit = {
                Column(verticalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
                    section.stack.forEach { tile -> MosaicCard(tile, selected, onClick, onLongClick) }
                }
            }
            if (section.heroOnLeft) {
                MosaicCard(section.hero, selected, onClick, onLongClick)
                stack()
            } else {
                stack()
                MosaicCard(section.hero, selected, onClick, onLongClick)
            }
        }
    }
}

@Composable
private fun MosaicCard(
    tile: MosaicTile,
    selected: (DocumentDto) -> Boolean,
    onClick: (DocumentDto) -> Unit,
    onLongClick: (DocumentDto) -> Unit,
) {
    DocumentCard(
        document = tile.doc,
        selected = selected(tile.doc),
        onClick = { onClick(tile.doc) },
        onLongClick = { onLongClick(tile.doc) },
        modifier = Modifier.width(tile.width.dp).height(tile.height.dp),
    )
}

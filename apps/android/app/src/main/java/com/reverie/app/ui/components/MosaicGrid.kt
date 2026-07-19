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
import kotlin.math.roundToInt

/**
 * Google-Photos-style "quilted" grid for the Files view. Every tile snaps to one fixed cell size on
 * a fixed column count, so columns line up top-to-bottom and the grid reads clean rather than busy.
 * Three tile shapes, all integer multiples of the cell:
 *   - 1×1 — the default square cell (portraits/landscapes are center-cropped),
 *   - 2×2 — an occasional "feature" tile, paired with 1×1 fillers so the band stays rectangular,
 *   - full-width — a panorama spanning every column at one cell of height.
 *
 * All geometry is in dp. [computeMosaicSections] is pure so it can be unit-tested and re-run cheaply
 * on rotation/width change.
 */

/** Hairline gap between tiles. */
const val MOSAIC_GAP = 2f

private const val TARGET_CELL = 125f // dp; yields 3 columns on a typical phone
private const val PANO_ASPECT = 2.2f // width/height ≥ this (with real dims) → full-width band
private const val FEATURE_MIN_ASPECT = 0.5f // a 2×2 crop of anything taller than this reads fine
private const val FEATURE_COOLDOWN_BANDS = 3 // ≥ this many plain bands between feature blocks

/** One tile: the document plus its resolved size in dp. */
data class MosaicTile(val doc: DocumentDto, val width: Float, val height: Float)

/** A packed band of the grid. Each band fills the full width and an integer number of cell rows. */
sealed interface MosaicSection {
    /** All tiles in document order, so callers can locate a document regardless of band shape. */
    val tiles: List<MosaicTile>
}

/** A row of 1×1 cells (1..columns of them; fewer only in the trailing row). */
data class MosaicRow(override val tiles: List<MosaicTile>) : MosaicSection

/** A single full-width tile, one cell tall — a panorama. */
data class MosaicWide(val tile: MosaicTile) : MosaicSection {
    override val tiles: List<MosaicTile> get() = listOf(tile)
}

/** A 2×2 feature tile plus 1×1 fillers packed into the remaining cells; sides alternate per block. */
data class MosaicFeature(
    val feature: MosaicTile,
    val fillers: List<MosaicTile>, // 2 per remaining column, stacked
    val featureOnLeft: Boolean,
) : MosaicSection {
    override val tiles: List<MosaicTile> get() = listOf(feature) + fillers
}

private fun DocumentDto.isPano(): Boolean = (mediaAspectOrNull() ?: 0f) >= PANO_ASPECT

// Any real photo/video (a rendered thumbnail with sane dims) can lead a feature — the 2×2 tile is a
// center crop, so the aspect barely matters. Panoramas are excluded (they get their own full-width
// band) and non-previewable files (icons) never balloon to a broken 2×2.
private fun DocumentDto.canFeature(): Boolean {
    if (!hasRenderedThumbnail) return false
    val aspect = mediaAspectOrNull() ?: return false
    return aspect >= FEATURE_MIN_ASPECT && aspect < PANO_ASPECT
}

/**
 * Pack [docs] onto a fixed [availableWidth]-wide cell grid. The column count comes from [targetCell];
 * every tile is a whole number of cells, so the layout aligns to a grid like Google Photos.
 *
 * The packer is a left-to-right fold whose decision at each position looks only at the current
 * document (plus a fixed lookahead for a feature's fillers). A band is closed and never revised once
 * emitted, so appending more documents only reflows the trailing partial row — pagination never
 * reshuffles bands already on screen.
 */
fun computeMosaicSections(
    docs: List<DocumentDto>,
    availableWidth: Float,
    targetCell: Float = TARGET_CELL,
    gap: Float = MOSAIC_GAP,
): List<MosaicSection> {
    if (docs.isEmpty() || availableWidth <= 0f || targetCell <= 0f) return emptyList()
    val columns = (availableWidth / targetCell).roundToInt().coerceAtLeast(3)
    val cell = (availableWidth - (columns - 1) * gap) / columns
    val featureEdge = 2f * cell + gap // a 2×2 tile spans two cells plus the gap between them
    val fillerCount = 2 * (columns - 2) // fill the (columns-2)×2 cells beside the feature

    val sections = mutableListOf<MosaicSection>()
    var i = 0
    var bandsSinceFeature = FEATURE_COOLDOWN_BANDS // allow a feature as soon as content permits
    var featureCount = 0
    while (i < docs.size) {
        // 1) Panorama → its own full-width band, one cell tall.
        if (docs[i].isPano()) {
            sections += MosaicWide(MosaicTile(docs[i], availableWidth, cell))
            i++
            bandsSinceFeature++
            continue
        }
        // 2) Occasional 2×2 feature (needs non-pano fillers to complete the rectangle).
        if (bandsSinceFeature >= FEATURE_COOLDOWN_BANDS && docs[i].canFeature() && fillersAvailable(docs, i + 1, fillerCount)) {
            val fillers = (0 until fillerCount).map { MosaicTile(docs[i + 1 + it], cell, cell) }
            sections += MosaicFeature(MosaicTile(docs[i], featureEdge, featureEdge), fillers, featureOnLeft = featureCount % 2 == 0)
            i += 1 + fillerCount
            featureCount++
            bandsSinceFeature = 0
            continue
        }
        // 3) A plain row of 1×1 cells, stopping before a panorama (it wants its own full-width band).
        val row = mutableListOf<MosaicTile>()
        while (i < docs.size && row.size < columns && !docs[i].isPano()) {
            row += MosaicTile(docs[i], cell, cell)
            i++
        }
        sections += MosaicRow(row)
        bandsSinceFeature++
    }
    return sections
}

/** True when [count] documents starting at [start] all exist and none is a panorama. */
private fun fillersAvailable(docs: List<DocumentDto>, start: Int, count: Int): Boolean {
    if (start + count > docs.size) return false
    for (k in start until start + count) if (docs[k].isPano()) return false
    return true
}

/**
 * A quilted Files grid: a [LazyColumn] of packed bands. Owns infinite-scroll paging and the
 * return-transform scroll sync (both keyed on bands, not documents) so [BrowseScreen] stays lean.
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
        val sections = remember(documents, maxWidth) {
            computeMosaicSections(documents, maxWidth.value)
        }

        // Infinite scroll: fetch the next page as the last band approaches.
        LaunchedEffect(listState, hasMore, sections.size) {
            snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
                .distinctUntilChanged()
                .collect { lastIndex -> if (hasMore && lastIndex >= sections.size - 2) onLoadMore() }
        }

        // Return-transform sync: scroll the band holding the focused document into view so the
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
            items(sections.size, key = { sections[it].tiles.first().doc.id }, contentType = { "band" }) { index ->
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
        is MosaicWide -> MosaicCard(section.tile, selected, onClick, onLongClick)
        is MosaicRow -> Row(horizontalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
            section.tiles.forEach { tile -> MosaicCard(tile, selected, onClick, onLongClick) }
        }
        is MosaicFeature -> Row(horizontalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
            // Fillers pack into columns of two stacked cells, filling the space beside the 2×2 tile.
            val fillerColumns: @Composable () -> Unit = {
                section.fillers.chunked(2).forEach { column ->
                    Column(verticalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
                        column.forEach { tile -> MosaicCard(tile, selected, onClick, onLongClick) }
                    }
                }
            }
            if (section.featureOnLeft) {
                MosaicCard(section.feature, selected, onClick, onLongClick)
                fillerColumns()
            } else {
                fillerColumns()
                MosaicCard(section.feature, selected, onClick, onLongClick)
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

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
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.domain.model.ThumbnailSize
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlin.math.roundToInt

/**
 * Google-Photos-style "quilted" grid for the Files view. A fixed 3-column cell grid where **most
 * photos are 1×1 squares**; larger tiles are sprinkled in on a jittered cadence so the grid reads
 * clean but not repetitive:
 *   - 1×1 — the default square cell (photos are center-cropped),
 *   - 2×2 / 3×2 — feature blocks; 3×2 spans the full width two rows tall,
 *   - 3×3 — a rare full-width, three-row hero,
 *   - 1×3 / 2×3 — tall blocks, used **only for portrait photos** so a landscape is never forced tall.
 *
 * A photo's aspect ratio does NOT decide its size — a position hash does (with tall tiles gated to
 * portraits). The hash is position-based, so the layout is stable across pagination. Every band fills
 * the full width, so there are never empty cells mid-grid. [computeMosaicSections] is pure and cheap.
 */

/** Hairline gap between tiles. */
const val MOSAIC_GAP = 2f

private const val TARGET_CELL = 125f // dp; yields 3 columns on a typical phone
private const val PORTRAIT_MAX = 0.9f // aspect below this → portrait → eligible for a tall tile
private const val JUSTIFIED_ROW_HEIGHT = 120f // dp target; ~3 landscapes per row on a phone
private const val JUSTIFIED_MIN_ASPECT = 0.5f // clamp so extremes don't wreck a shared row
private const val JUSTIFIED_MAX_ASPECT = 3.2f
private const val LARGE_TILE_DP = 175f // a tile bigger than this needs the LG thumbnail, not MD

/** One tile: the document plus its resolved size in dp. */
data class MosaicTile(val doc: DocumentDto, val width: Float, val height: Float)

/** A packed band of the grid. Each band fills the full width and an integer number of cell rows. */
sealed interface MosaicSection {
    /** All tiles in document order, so callers can locate a document regardless of band shape. */
    val tiles: List<MosaicTile>
}

/** A row of 1×1 cells (1..columns of them; fewer only in the trailing row). */
data class MosaicRow(override val tiles: List<MosaicTile>) : MosaicSection

/**
 * A feature block: one large [feature] tile spanning [featureCols]×[blockRows] cells, plus 1×1
 * [fillers] packing the remaining `(columns - featureCols)` columns over [blockRows] rows (empty when
 * the feature is full-width). [featureOnLeft] alternates the big tile's side.
 */
data class MosaicBlock(
    val feature: MosaicTile,
    val fillers: List<MosaicTile>,
    val blockRows: Int,
    val featureOnLeft: Boolean,
) : MosaicSection {
    override val tiles: List<MosaicTile> get() = listOf(feature) + fillers
}

/** Deterministic hash of an integer → [0,1). Position-based so the layout is stable across pagination. */
private fun hash01(seed: Int): Float {
    var n = seed
    n = (n xor 61) xor (n ushr 16)
    n += n shl 3
    n = n xor (n ushr 4)
    n *= 0x27d4eb2d
    n = n xor (n ushr 15)
    return (n.toLong() and 0xffffffffL).toFloat() / 4294967296f
}

/** True when [doc] is a real photo/video (rendered thumbnail + known dims) that can lead a feature. */
private fun DocumentDto.canFeature(): Boolean = hasRenderedThumbnail && mediaAspectOrNull() != null

/**
 * Pack [docs] onto a fixed [availableWidth]-wide cell grid. A larger feature tile appears roughly
 * every [featureEvery] photos, jittered by a position hash so the placement looks organic but is
 * deterministic (stable across pagination — a band is never revised once emitted).
 */
fun computeMosaicSections(
    docs: List<DocumentDto>,
    availableWidth: Float,
    featureEvery: Int,
    targetCell: Float = TARGET_CELL,
    gap: Float = MOSAIC_GAP,
): List<MosaicSection> {
    if (docs.isEmpty() || availableWidth <= 0f || targetCell <= 0f) return emptyList()
    val columns = (availableWidth / targetCell).roundToInt().coerceAtLeast(3)
    val cell = (availableWidth - (columns - 1) * gap) / columns
    fun span(n: Int) = n * cell + (n - 1) * gap // dp size across n cells

    val sections = mutableListOf<MosaicSection>()
    var i = 0
    var since = 0
    var featureIndex = 0
    // The next feature fires once `since` reaches this jittered target (featureEvery ± ~2, min 2).
    fun nextTarget() = (featureEvery + (hash01(featureIndex * 9176 + 3) * 5f).roundToInt() - 2).coerceAtLeast(2)
    var target = nextTarget()

    while (i < docs.size) {
        val doc = docs[i]
        if (since >= target && doc.canFeature()) {
            val roll = hash01(i * 2654 + 1)
            val aspect = doc.mediaAspectOrNull() ?: 1f
            // (featureCols, blockRows) chosen by hash; tall tiles gated to portraits, 3×3 is rare.
            val (featureCols, blockRows) = when {
                aspect < PORTRAIT_MAX -> if (roll < 0.5f) 2 to 3 else 1 to 3
                roll < 0.55f -> 2 to 2
                roll < 0.90f -> columns to 2
                else -> columns to 3
            }
            val fillerCount = (columns - featureCols) * blockRows
            if (i + fillerCount < docs.size) {
                val fillers = (0 until fillerCount).map { MosaicTile(docs[i + 1 + it], cell, cell) }
                sections += MosaicBlock(
                    feature = MosaicTile(doc, span(featureCols), span(blockRows)),
                    fillers = fillers,
                    blockRows = blockRows,
                    featureOnLeft = hash01(i * 71 + 7) < 0.5f,
                )
                i += 1 + fillerCount
                featureIndex++
                since = 0
                target = nextTarget()
                continue
            }
            // Not enough photos left for the fillers → fall through to a plain row.
        }
        val row = mutableListOf<MosaicTile>()
        while (i < docs.size && row.size < columns) {
            row += MosaicTile(docs[i], cell, cell)
            i++
        }
        sections += MosaicRow(row)
        since += row.size
    }
    return sections
}

private fun DocumentDto.justifiedAspect(): Float =
    (mediaAspectOrNull() ?: 1f).coerceIn(JUSTIFIED_MIN_ASPECT, JUSTIFIED_MAX_ASPECT)

/**
 * Flickr-style justified rows: each photo keeps its natural aspect ratio, and each row is scaled to
 * fill the width at roughly [targetRowHeight]. The trailing partial row keeps the target height (not
 * stretched). Every full row fills the width, so there are no gaps.
 */
fun computeJustifiedSections(
    docs: List<DocumentDto>,
    availableWidth: Float,
    targetRowHeight: Float = JUSTIFIED_ROW_HEIGHT,
    gap: Float = MOSAIC_GAP,
): List<MosaicSection> {
    if (docs.isEmpty() || availableWidth <= 0f || targetRowHeight <= 0f) return emptyList()
    val sections = mutableListOf<MosaicSection>()
    var i = 0
    while (i < docs.size) {
        val row = mutableListOf<DocumentDto>()
        var aspectSum = 0f
        var full = false
        while (i < docs.size) {
            row += docs[i]
            aspectSum += docs[i].justifiedAspect()
            i++
            // Close the row once justifying it would drop to (or below) the target height.
            if ((availableWidth - gap * (row.size - 1)) / aspectSum <= targetRowHeight) {
                full = true
                break
            }
        }
        val height = if (full) (availableWidth - gap * (row.size - 1)) / aspectSum else targetRowHeight
        var used = 0f
        val tiles = row.mapIndexed { index, doc ->
            val width = if (full && index == row.lastIndex) {
                availableWidth - gap * (row.size - 1) - used // absorb rounding so the row fills exactly
            } else {
                (height * doc.justifiedAspect()).also { used += it }
            }
            MosaicTile(doc, width, height)
        }
        sections += MosaicRow(tiles)
    }
    return sections
}

/** A plain uniform grid: every tile the same square, [columns]-wide rows. */
fun computeUniformSections(
    docs: List<DocumentDto>,
    availableWidth: Float,
    targetCell: Float = TARGET_CELL,
    gap: Float = MOSAIC_GAP,
): List<MosaicSection> {
    if (docs.isEmpty() || availableWidth <= 0f || targetCell <= 0f) return emptyList()
    val columns = (availableWidth / targetCell).roundToInt().coerceAtLeast(3)
    val cell = (availableWidth - (columns - 1) * gap) / columns
    return docs.chunked(columns).map { chunk -> MosaicRow(chunk.map { MosaicTile(it, cell, cell) }) }
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
    layoutMode: GridLayoutMode,
    featureEvery: Int,
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
        val sections = remember(documents, maxWidth, layoutMode, featureEvery) {
            when (layoutMode) {
                GridLayoutMode.MOSAIC -> computeMosaicSections(documents, maxWidth.value, featureEvery)
                GridLayoutMode.JUSTIFIED -> computeJustifiedSections(documents, maxWidth.value)
                GridLayoutMode.UNIFORM -> computeUniformSections(documents, maxWidth.value)
            }
        }

        // Infinite scroll: fetch the next page as the last band approaches.
        LaunchedEffect(listState, hasMore, sections.size) {
            snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
                .distinctUntilChanged()
                .collect { lastIndex -> if (hasMore && lastIndex >= sections.size - 2) onLoadMore() }
        }

        // Return-transform sync: scroll the band holding the focused document into view.
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
        is MosaicRow -> Row(horizontalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
            section.tiles.forEach { tile -> MosaicCard(tile, selected, onClick, onLongClick) }
        }
        is MosaicBlock -> Row(horizontalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp)) {
            // Fillers pack into columns of `blockRows` stacked cells, beside the feature tile.
            val fillerColumns: @Composable () -> Unit = {
                section.fillers.chunked(section.blockRows).forEach { column ->
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
    // Tiles bigger than one cell would upscale the MD thumbnail visibly — pull the LG source instead.
    val thumbnailSize = if (maxOf(tile.width, tile.height) > LARGE_TILE_DP) ThumbnailSize.LG else GRID_THUMBNAIL_SIZE
    DocumentCard(
        document = tile.doc,
        selected = selected(tile.doc),
        onClick = { onClick(tile.doc) },
        onLongClick = { onLongClick(tile.doc) },
        thumbnailSize = thumbnailSize,
        modifier = Modifier.width(tile.width.dp).height(tile.height.dp),
    )
}

package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.components.DocumentCard
import com.reverie.app.ui.components.MOSAIC_GAP
import com.reverie.app.ui.components.MosaicSectionView
import com.reverie.app.ui.components.SelectedCheck
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.components.fileTypeVisual
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.theme.GeistMonoFontFamily
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatTimeOfDay

/** What a row's tiles do when tapped, held or selected. */
class RowActions(
    val selected: (DocumentDto) -> Boolean,
    val onClick: (DocumentDto) -> Unit,
    val onLongClick: (DocumentDto) -> Unit,
)

/** Draws one lazy-list row of a Browse tab. */
@Composable
fun FeedRowView(row: FeedRow, actions: RowActions) {
    when (row) {
        is FeedRow.Heading -> HeadingRow(row.header)
        is FeedRow.Band -> Box(Modifier.padding(bottom = MOSAIC_GAP.dp)) {
            MosaicSectionView(row.section, actions.selected, actions.onClick, actions.onLongClick)
        }
        is FeedRow.Videos -> VideoTiles(row.docs, actions)
        is FeedRow.File -> FileRow(row.doc, row.slot, actions)
    }
}

@Composable
private fun HeadingRow(header: FeedItem.Header) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, top = 18.dp, end = 20.dp, bottom = 10.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            text = header.title,
            fontSize = 17.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = header.trailing,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

private val VIDEO_TILE_HEIGHT = 196.dp
private val VIDEO_TILE_GAP = 8.dp

/** Two video tiles side by side; a lone video in a month's last row keeps its half width. */
@Composable
private fun VideoTiles(docs: List<DocumentDto>, actions: RowActions) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = VIDEO_TILE_GAP),
        horizontalArrangement = Arrangement.spacedBy(VIDEO_TILE_GAP),
    ) {
        docs.forEach { doc ->
            DocumentCard(
                document = doc,
                selected = actions.selected(doc),
                onClick = { actions.onClick(doc) },
                onLongClick = { actions.onLongClick(doc) },
                shape = RoundedCornerShape(14.dp),
                largeVideoTile = true,
                modifier = Modifier.weight(1f).height(VIDEO_TILE_HEIGHT),
            )
        }
        if (docs.size == 1) Spacer(Modifier.weight(1f))
    }
}

private val CARD_RADIUS = 16.dp

private fun CardSlot.shape(): Shape = when (this) {
    CardSlot.ONLY -> RoundedCornerShape(CARD_RADIUS)
    CardSlot.FIRST -> RoundedCornerShape(topStart = CARD_RADIUS, topEnd = CARD_RADIUS)
    CardSlot.MIDDLE -> RectangleShape
    CardSlot.LAST -> RoundedCornerShape(bottomStart = CARD_RADIUS, bottomEnd = CARD_RADIUS)
}

/**
 * A file row. In the All tab ([slot] set) it is one row of a rounded card, and the card's rows are
 * separate list items that each round their own corners. In the Files tab it stands on the page and
 * has an overflow menu.
 */
@Composable
private fun FileRow(doc: DocumentDto, slot: CardSlot?, actions: RowActions) {
    if (slot == null) {
        FileRowContent(doc, actions, compact = false, modifier = Modifier.height(64.dp).padding(start = 20.dp, end = 8.dp))
        return
    }
    val topEdge = slot == CardSlot.FIRST || slot == CardSlot.ONLY
    val bottomEdge = slot == CardSlot.LAST || slot == CardSlot.ONLY
    Box(
        Modifier
            .padding(horizontal = 12.dp)
            .clip(slot.shape())
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(top = if (topEdge) 4.dp else 0.dp, bottom = if (bottomEdge) 4.dp else 0.dp),
    ) {
        FileRowContent(doc, actions, compact = true, modifier = Modifier.height(56.dp).padding(horizontal = 14.dp))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRowContent(doc: DocumentDto, actions: RowActions, compact: Boolean, modifier: Modifier) {
    val selected = actions.selected(doc)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .documentSharedBounds(doc.id)
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
            .combinedClickable(onClick = { actions.onClick(doc) }, onLongClick = { actions.onLongClick(doc) })
            .then(modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (compact) 12.dp else 14.dp),
    ) {
        if (selected) SelectedCheck(Modifier.size(36.dp)) else TypeBadge(doc)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = doc.original_filename,
                fontSize = 15.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = fileMeta(doc),
                fontSize = if (compact) 12.sp else 13.sp,
                lineHeight = if (compact) 16.sp else 18.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (!compact) FileMenu(doc, actions)
    }
}

/** "2.4 MB · 14:03": the size and the time the file was added. */
private fun fileMeta(doc: DocumentDto): String =
    listOfNotNull(formatBytes(doc.size_bytes), formatTimeOfDay(doc.created_at)).joinToString(" · ")

@Composable
private fun TypeBadge(doc: DocumentDto) {
    val tint = fileTypeVisual(doc.mime_type, doc.original_filename).tint
    Box(
        modifier = Modifier.size(36.dp).clip(RoundedCornerShape(9.dp)).background(tint.copy(alpha = 0.16f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = fileTypeLabel(doc.mime_type, doc.original_filename),
            color = tint,
            fontFamily = GeistMonoFontFamily,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun FileMenu(doc: DocumentDto, actions: RowActions) {
    var open by remember { mutableStateOf(false) }
    // The menu anchors to the Box around its button.
    Box {
        IconButton(onClick = { open = true }) {
            Icon(
                Icons.Outlined.MoreVert,
                contentDescription = "More",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Open") }, onClick = { open = false; actions.onClick(doc) })
            DropdownMenuItem(text = { Text("Select") }, onClick = { open = false; actions.onLongClick(doc) })
        }
    }
}

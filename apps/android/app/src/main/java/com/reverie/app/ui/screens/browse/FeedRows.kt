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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.components.FavouriteMenuItem
import com.reverie.app.ui.components.MOSAIC_GAP
import com.reverie.app.ui.components.MosaicSectionView
import com.reverie.app.ui.components.NameWithStar
import com.reverie.app.ui.components.SelectedCheck
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.components.fileTypeVisual
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.theme.GeistMonoFontFamily
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatTimeOfDay
import java.time.LocalDate
import java.time.ZoneId

/** The name line of a file row and of a Recently added row. */
internal val ROW_NAME_STYLE = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)

/** What a list's tiles and rows do when tapped, held or selected. The group actions are for folded lists. */
class RowActions(
    val selected: (DocumentDto) -> Boolean,
    val onClick: (DocumentDto) -> Unit,
    val onLongClick: (DocumentDto) -> Unit,
    val starred: (DocumentDto) -> Boolean = { false },
    val onToggleStar: (DocumentDto) -> Unit = {},
    val onGroupClick: (RecentRow.Group) -> Unit = {},
    val onGroupLongClick: (RecentRow.Group) -> Unit = {},
)

/** Draws one lazy-list row of a document list. */
@Composable
fun FeedRowView(row: FeedRow, actions: RowActions, today: LocalDate, zone: ZoneId) {
    when (row) {
        is FeedRow.Heading -> HeadingRow(row.header)
        is FeedRow.Section -> SectionRow(row.title)
        is FeedRow.Band -> Box(Modifier.padding(bottom = MOSAIC_GAP.dp)) {
            MosaicSectionView(row.section, actions.selected, actions.onClick, actions.onLongClick, actions.starred)
        }
        is FeedRow.File -> FileRow(row.doc, actions)
        is FeedRow.Added -> RecentEntryView(row.entry, actions, today, zone)
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
            fontSize = 15.sp,
            lineHeight = 20.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

/** Names one of a folder's two sections, above that section's first day. */
@Composable
private fun SectionRow(title: String) {
    Text(
        text = title,
        fontSize = 17.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, top = 24.dp, end = 20.dp),
    )
}

/** A file row: it stands on the page and has an overflow menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(doc: DocumentDto, actions: RowActions) {
    val selected = actions.selected(doc)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .documentSharedBounds(doc.id)
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
            .combinedClickable(onClick = { actions.onClick(doc) }, onLongClick = { actions.onLongClick(doc) })
            .height(64.dp)
            .padding(start = 20.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (selected) SelectedCheck(Modifier.size(36.dp)) else TypeBadge(doc)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            NameWithStar(doc.original_filename, actions.starred(doc), style = ROW_NAME_STYLE)
            Text(
                text = fileMeta(doc),
                fontSize = 13.sp,
                lineHeight = 18.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        FileMenu(doc, actions)
    }
}

/** "2.4 MB · 14:03": the size and the time the file was added. */
fun fileMeta(doc: DocumentDto): String =
    listOfNotNull(formatBytes(doc.size_bytes), formatTimeOfDay(doc.created_at)).joinToString(" · ")

@Composable
fun TypeBadge(doc: DocumentDto, size: Dp = 36.dp) {
    val tint = fileTypeVisual(doc.mime_type, doc.original_filename).tint
    Box(
        modifier = Modifier.size(size).clip(RoundedCornerShape(9.dp)).background(tint.copy(alpha = 0.16f)),
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

/** A row's ⋮ button and its menu. */
@Composable
internal fun FileMenu(doc: DocumentDto, actions: RowActions) {
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
            FileMenuItems(doc, actions, onDone = { open = false })
        }
    }
}

/** The file menu's items. Open and Select are indented to line up with the starred item's text. */
@Composable
fun FileMenuItems(doc: DocumentDto, actions: RowActions, onDone: () -> Unit = {}) {
    val indent: @Composable () -> Unit = { Spacer(Modifier.size(24.dp)) }
    FavouriteMenuItem(actions.starred(doc)) { onDone(); actions.onToggleStar(doc) }
    DropdownMenuItem(text = { Text("Open") }, leadingIcon = indent, onClick = { onDone(); actions.onClick(doc) })
    DropdownMenuItem(text = { Text("Select") }, leadingIcon = indent, onClick = { onDone(); actions.onLongClick(doc) })
}

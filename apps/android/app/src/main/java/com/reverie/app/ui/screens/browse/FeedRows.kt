package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.components.FileKindBlock
import com.reverie.app.ui.components.MOSAIC_GAP
import com.reverie.app.ui.components.MosaicSectionView
import com.reverie.app.ui.components.NameWithStar
import com.reverie.app.ui.components.SelectedCheck
import com.reverie.app.ui.components.selectedBackground
import com.reverie.app.ui.navigation.documentSharedBounds
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

/** A file row: it stands on the page. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(doc: DocumentDto, actions: RowActions) {
    val selected = actions.selected(doc)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .documentSharedBounds(doc.id)
            .selectedBackground(selected)
            .combinedClickable(onClick = { actions.onClick(doc) }, onLongClick = { actions.onLongClick(doc) })
            .height(64.dp)
            .padding(horizontal = 20.dp),
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
    }
}

/** "2.4 MB · 14:03": the size and the time the file was added. */
fun fileMeta(doc: DocumentDto): String =
    listOfNotNull(formatBytes(doc.size_bytes), formatTimeOfDay(doc.created_at)).joinToString(" · ")

/** A file's extension on a small block, in the place a photo's thumbnail would take. */
@Composable
fun TypeBadge(doc: DocumentDto, size: Dp = 36.dp) {
    FileKindBlock(doc.mime_type, doc.original_filename, Modifier.size(size).clip(MaterialTheme.shapes.medium))
}

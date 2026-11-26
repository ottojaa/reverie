package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.kind
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.NameWithStar
import com.reverie.app.ui.components.SelectedCheck
import com.reverie.app.ui.components.selectedBackground
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatDuration
import java.time.LocalDate
import java.time.ZoneId

private val THUMB = 52.dp
private val MEMBER_INDENT = 20.dp
private val ADDED_NAME_STYLE = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)

/** Draws one entry of a list of additions: a row, or a member under an opened group. */
@Composable
fun RecentEntryView(entry: RecentEntry, actions: RowActions, today: LocalDate, zone: ZoneId) {
    when (entry) {
        is RecentEntry.Member -> DocRow(entry.doc, actions, today, zone, indent = MEMBER_INDENT)
        is RecentEntry.Row -> when (val row = entry.row) {
            is RecentRow.Single -> DocRow(row.doc, actions, today, zone, indent = 0.dp)
            is RecentRow.Group -> GroupRow(row, entry.expanded, actions, today, zone)
        }
    }
}

@Composable
private fun DocRow(doc: DocumentDto, actions: RowActions, today: LocalDate, zone: ZoneId, indent: Dp) {
    RowShell(
        name = doc.original_filename,
        meta = listOf(docMeta(doc), recentWhen(doc, today, zone)).filter { it.isNotEmpty() }.joinToString(" · "),
        selected = actions.selected(doc),
        isStarred = actions.starred(doc),
        indent = indent,
        onClick = { actions.onClick(doc) },
        onLongClick = { actions.onLongClick(doc) },
        modifier = Modifier.documentSharedBounds(doc.id),
        thumb = { DocThumb(doc) },
    )
}

@Composable
private fun GroupRow(group: RecentRow.Group, expanded: Boolean, actions: RowActions, today: LocalDate, zone: ZoneId) {
    val isStack = group.groupKind == GroupKind.STACK
    val label = if (isStack) stackLabel(group.docs, today, zone) else foldLabel(group.docs, today, zone)
    RowShell(
        name = if (isStack) group.docs.first().original_filename else label,
        meta = if (isStack) label else recentWhen(group.docs.first(), today, zone),
        selected = group.docs.all(actions.selected),
        indent = 0.dp,
        onClick = { actions.onGroupClick(group) },
        onLongClick = { actions.onGroupLongClick(group) },
        modifier = Modifier.semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
        thumb = { if (isStack) StackedBadge(group.docs.first()) else ThumbnailPile(group.docs) },
    )
}

/** The one row shape of a list of additions: a 52dp picture and the name over a meta line. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RowShell(
    name: String,
    meta: String,
    selected: Boolean,
    indent: Dp,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    isStarred: Boolean = false,
    thumb: @Composable () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .selectedBackground(selected)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .heightIn(min = 64.dp)
            .padding(start = 20.dp + indent, end = 20.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(THUMB), contentAlignment = Alignment.Center) {
            if (selected) SelectedCheck(Modifier.size(36.dp)) else thumb()
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            NameWithStar(name, isStarred, style = ADDED_NAME_STYLE)
            Text(
                meta,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** "Photo · 3.2 MB", "Video · 0:42 · 18 MB", "APK · 6.2 MB". */
private fun docMeta(doc: DocumentDto): String {
    val type = when (doc.kind) {
        DocumentKind.IMAGE -> "Photo"
        DocumentKind.VIDEO -> "Video"
        DocumentKind.FILE -> fileTypeLabel(doc.mime_type, doc.original_filename)
    }
    return listOfNotNull(type, doc.duration_seconds?.takeIf { doc.kind == DocumentKind.VIDEO }?.let(::formatDuration), formatBytes(doc.size_bytes))
        .joinToString(" · ")
}

@Composable
private fun DocThumb(doc: DocumentDto) {
    if (doc.kind == DocumentKind.FILE) {
        TypeBadge(doc, THUMB)
        return
    }
    Thumbnail(doc, Modifier.size(THUMB).clip(MaterialTheme.shapes.medium))
}

@Composable
private fun Thumbnail(doc: DocumentDto, modifier: Modifier) = DocumentThumbnail(
    documentId = doc.id,
    mimeType = doc.mime_type,
    filename = doc.original_filename,
    blurhash = doc.thumbnail_blurhash,
    hasThumbnail = doc.hasRenderedThumbnail,
    modifier = modifier,
    size = ThumbnailSize.MD,
)

/** A small pile of the folded thumbnails, the newest in front. */
@Composable
private fun ThumbnailPile(docs: List<DocumentDto>) {
    val shown = docs.take(3)
    val ring = MaterialTheme.colorScheme.background
    val shape = MaterialTheme.shapes.medium
    Box(Modifier.size(THUMB).semantics { contentDescription = "Folded" }) {
        // Back to front, so the newest ends up on top at the bottom-left.
        shown.indices.reversed().forEach { depth ->
            Thumbnail(
                shown[depth],
                Modifier.size(44.dp).offset(x = (depth * 4).dp, y = (8 - depth * 4).dp)
                    .clip(shape).border(2.dp, ring, shape),
            )
        }
    }
}

/** The type badge with two sheets peeking out behind it: the same file, several versions. */
@Composable
private fun StackedBadge(doc: DocumentDto) {
    val ring = MaterialTheme.colorScheme.background
    val shape = MaterialTheme.shapes.medium
    // Back to front, each a surface step lighter in weight than the badge.
    val sheets = listOf(
        2 to MaterialTheme.colorScheme.surfaceContainer,
        1 to MaterialTheme.colorScheme.surfaceContainerHigh,
    )
    Box(Modifier.size(THUMB).semantics { contentDescription = "Stacked versions" }) {
        sheets.forEach { (depth, sheet) ->
            Box(
                Modifier.size(42.dp).offset(x = (depth * 4).dp, y = (10 - depth * 4).dp).clip(shape)
                    .background(sheet)
                    .border(1.5.dp, ring, shape),
            )
        }
        Box(Modifier.offset(y = 10.dp)) { TypeBadge(doc, 42.dp) }
    }
}

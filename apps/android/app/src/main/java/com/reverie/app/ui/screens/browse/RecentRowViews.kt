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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
import com.reverie.app.ui.components.SelectedCheck
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.components.fileTypeVisual
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatDuration
import java.time.LocalDate
import java.time.ZoneId

/** What a tap or a long press does on Recently added's rows; the screen decides between opening, expanding and selecting. */
class RecentActions(
    val selectedIds: Set<String>,
    val onDocClick: (DocumentDto) -> Unit,
    val onDocLongClick: (DocumentDto) -> Unit,
    val onGroupClick: (RecentRow.Group) -> Unit,
    val onGroupLongClick: (RecentRow.Group) -> Unit,
)

private val THUMB = 44.dp
private val MEMBER_INDENT = 20.dp

/** Draws one entry of Recently added: a row, or a member under an opened group. */
@Composable
fun RecentEntryView(entry: RecentEntry, actions: RecentActions, today: LocalDate, zone: ZoneId) {
    when (entry) {
        is RecentEntry.Member -> DocRow(entry.doc, actions, today, zone, indent = MEMBER_INDENT)
        is RecentEntry.Row -> when (val row = entry.row) {
            is RecentRow.Single -> DocRow(row.doc, actions, today, zone, indent = 0.dp)
            is RecentRow.Group -> GroupRow(row, entry.expanded, actions, today, zone)
        }
    }
}

@Composable
private fun DocRow(doc: DocumentDto, actions: RecentActions, today: LocalDate, zone: ZoneId, indent: Dp) {
    val selected = doc.id in actions.selectedIds
    RowShell(
        name = doc.original_filename,
        meta = docMeta(doc),
        whenText = recentWhen(doc, today, zone),
        selected = selected,
        indent = indent,
        onClick = { actions.onDocClick(doc) },
        onLongClick = { actions.onDocLongClick(doc) },
        modifier = Modifier.documentSharedBounds(doc.id),
        thumb = { DocThumb(doc, Modifier.size(THUMB)) },
    )
}

@Composable
private fun GroupRow(group: RecentRow.Group, expanded: Boolean, actions: RecentActions, today: LocalDate, zone: ZoneId) {
    val isStack = group.groupKind == GroupKind.STACK
    val label = if (isStack) stackLabel(group.docs, today, zone) else foldLabel(group.docs, today, zone)
    RowShell(
        name = if (isStack) group.docs.first().original_filename else label,
        meta = if (isStack) label else null,
        metaAccent = isStack,
        whenText = recentWhen(group.docs.first(), today, zone),
        selected = group.docs.all { it.id in actions.selectedIds },
        indent = 0.dp,
        onClick = { actions.onGroupClick(group) },
        onLongClick = { actions.onGroupLongClick(group) },
        modifier = Modifier.semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
        thumb = { if (isStack) StackedBadge(group.docs.first()) else ThumbnailPile(group.docs) },
    )
}

/** The one row shape of Recently added: a 44dp picture, the name over a meta line, and when. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RowShell(
    name: String,
    meta: String?,
    whenText: String,
    selected: Boolean,
    indent: Dp,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    metaAccent: Boolean = false,
    thumb: @Composable () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .heightIn(min = 60.dp)
            .padding(start = 20.dp + indent, end = 20.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(THUMB), contentAlignment = Alignment.Center) {
            if (selected) SelectedCheck(Modifier.size(36.dp)) else thumb()
        }
        Column(Modifier.weight(1f)) {
            Text(name, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (meta != null) {
                Text(
                    meta,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    color = if (metaAccent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(whenText, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
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
private fun DocThumb(doc: DocumentDto, modifier: Modifier) {
    if (doc.kind == DocumentKind.FILE) {
        TypeBadge(doc, THUMB)
        return
    }
    Thumbnail(doc, modifier.clip(RoundedCornerShape(10.dp)))
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
    val shape = RoundedCornerShape(9.dp)
    Box(Modifier.size(THUMB).semantics { contentDescription = "Folded" }) {
        // Back to front, so the newest ends up on top at the bottom-left.
        shown.indices.reversed().forEach { depth ->
            Thumbnail(
                shown[depth],
                Modifier.size(40.dp).offset(x = (depth * 4).dp, y = (4 - depth * 4).dp).clip(shape).border(2.dp, ring, shape),
            )
        }
    }
}

/** The type badge with two sheets peeking out behind it: the same file, several versions. */
@Composable
private fun StackedBadge(doc: DocumentDto) {
    val tint = fileTypeVisual(doc.mime_type, doc.original_filename).tint
    val ring = MaterialTheme.colorScheme.background
    val shape = RoundedCornerShape(9.dp)
    Box(Modifier.size(THUMB).semantics { contentDescription = "Stacked versions" }) {
        listOf(2, 1).forEach { depth ->
            Box(
                Modifier.size(34.dp).offset(x = (depth * 4).dp, y = (10 - depth * 4).dp).clip(shape)
                    .background(tint.copy(alpha = 0.16f * (3 - depth)).compositeOverBackground(ring))
                    .border(1.5.dp, ring, shape),
            )
        }
        Box(Modifier.offset(y = 10.dp)) { TypeBadge(doc, 34.dp) }
    }
}

private fun Color.compositeOverBackground(background: Color): Color =
    this.compositeOver(background)

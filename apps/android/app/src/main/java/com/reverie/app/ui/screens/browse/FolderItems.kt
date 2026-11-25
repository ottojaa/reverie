package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.kind
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FileKindBlock
import com.reverie.app.ui.components.NameWithStar
import com.reverie.app.ui.components.PrivateLockBadge
import com.reverie.app.ui.components.SelectedCheck
import com.reverie.app.ui.components.StarredBadge
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.theme.GeistMonoFontFamily
import com.reverie.app.util.formatDuration

/** Behind the marks drawn on a picture. The same in both themes: it sits on the picture. */
private val ON_PICTURE_SCRIM = Color(0xC7121212)

/** A folder's document as a square tile with its name under it. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FolderTile(doc: DocumentDto, actions: RowActions, modifier: Modifier = Modifier) {
    val selected = actions.selected(doc)
    Column(modifier.combinedClickable(onClick = { actions.onClick(doc) }, onLongClick = { actions.onLongClick(doc) })) {
        // Only the picture grows into the viewer: the viewer's first frame is this same cropped bitmap.
        Box(Modifier.fillMaxWidth().aspectRatio(1f).documentSharedBounds(doc.id).clip(RoundedCornerShape(12.dp))) {
            FolderPicture(doc, Modifier.matchParentSize(), labelSize = 12.sp)
            if (selected) {
                Box(Modifier.matchParentSize().background(MaterialTheme.colorScheme.primary.copy(alpha = 0.24f)))
                SelectedCheck(Modifier.align(Alignment.TopStart).padding(6.dp))
            } else if (doc.is_private) {
                PrivateLockBadge(Modifier.align(Alignment.TopStart).padding(6.dp))
            }
            if (actions.starred(doc)) StarredBadge(Modifier.align(Alignment.TopEnd).padding(6.dp))
            if (doc.kind == DocumentKind.VIDEO) VideoLengthPill(doc.duration_seconds, Modifier.align(Alignment.BottomEnd).padding(6.dp))
        }
        Text(
            text = doc.original_filename,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 5.dp),
        )
    }
}

/** A folder's document as a row: picture, name, [meta] line and overflow menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FolderRow(doc: DocumentDto, meta: String, actions: RowActions, modifier: Modifier = Modifier) {
    val selected = actions.selected(doc)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
            .combinedClickable(onClick = { actions.onClick(doc) }, onLongClick = { actions.onLongClick(doc) })
            .height(64.dp)
            .padding(start = 20.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp).documentSharedBounds(doc.id).clip(RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            FolderPicture(doc, Modifier.matchParentSize(), labelSize = 10.sp, compact = true)
            when {
                selected -> SelectedCheck()
                doc.kind == DocumentKind.VIDEO -> PlayDisc()
            }
        }
        Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            NameWithStar(doc.original_filename, actions.starred(doc), style = ROW_NAME_STYLE)
            Text(
                text = meta,
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

/** A photo's or video's thumbnail; for a file, or until a thumbnail exists, a block saying its type. */
@Composable
private fun FolderPicture(doc: DocumentDto, modifier: Modifier, labelSize: TextUnit, compact: Boolean = false) {
    if (doc.kind == DocumentKind.FILE || !doc.hasRenderedThumbnail) {
        FileKindBlock(
            mimeType = doc.mime_type,
            filename = doc.original_filename,
            modifier = modifier,
            compact = compact,
            labelAlignment = Alignment.Center,
            labelSize = labelSize,
        )
        return
    }
    DocumentThumbnail(
        documentId = doc.id,
        mimeType = doc.mime_type,
        filename = doc.original_filename,
        blurhash = doc.thumbnail_blurhash,
        hasThumbnail = true,
        modifier = modifier,
    )
}

/** A video tile's mark: a play triangle and, when known, the length. */
@Composable
private fun VideoLengthPill(seconds: Double?, modifier: Modifier) {
    Row(
        modifier = modifier
            .height(20.dp)
            .background(ON_PICTURE_SCRIM, RoundedCornerShape(10.dp))
            .padding(start = 5.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Icon(Icons.Filled.PlayArrow, contentDescription = "Video", tint = Color.White, modifier = Modifier.size(12.dp))
        if (seconds != null) {
            Text(
                text = formatDuration(seconds),
                color = Color.White,
                fontFamily = GeistMonoFontFamily,
                fontSize = 10.sp,
                lineHeight = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun PlayDisc() {
    Box(Modifier.size(22.dp).background(ON_PICTURE_SCRIM, CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.PlayArrow, contentDescription = "Video", tint = Color.White, modifier = Modifier.size(14.dp))
    }
}

package com.reverie.app.ui.screens.library

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.kind
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FileGridTile
import com.reverie.app.ui.components.SelectedCheck
import com.reverie.app.ui.components.StarredBadge
import com.reverie.app.ui.components.VideoBadge
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.browse.isNearEnd
import com.reverie.app.ui.screens.browse.recentWhen
import kotlinx.coroutines.flow.distinctUntilChanged

private val TILE = 132.dp

/** What was added last, newest first, as a row that runs off the side and loads more as it is scrolled. */
@Composable
fun RecentlyAdded(
    recent: FeedState,
    actions: RowActions,
    day: LibraryDay,
    rowState: LazyListState,
    onLoadMore: () -> Unit,
) {
    val documents = recent.documents.documents
    val hasMore = recent.documents.hasMore
    val loadMore by rememberUpdatedState(onLoadMore)
    LaunchedEffect(rowState, documents.size, hasMore) {
        snapshotFlow { rowState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
            .distinctUntilChanged()
            .collect { last -> if (isNearEnd(last, documents.size, hasMore)) loadMore() }
    }
    LazyRow(
        state = rowState,
        contentPadding = PaddingValues(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(documents, key = { it.id }) { RecentTile(it, actions, day) }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RecentTile(document: DocumentDto, actions: RowActions, day: LibraryDay) {
    Column(
        modifier = Modifier
            .width(TILE)
            .combinedClickable(onClick = { actions.onClick(document) }, onLongClick = { actions.onLongClick(document) }),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(Modifier.padding(bottom = 6.dp).size(TILE).documentSharedBounds(document.id).clip(MaterialTheme.shapes.large)) {
            TilePicture(document, Modifier.matchParentSize())
            TileMarks(document, actions.starred(document), Modifier.align(Alignment.TopEnd))
            if (actions.selected(document)) SelectionCover()
        }
        Text(document.original_filename, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            recentWhen(document, day.today, day.zone),
            fontSize = 12.sp,
            lineHeight = 16.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

/** A tile's corner: the favourite star and a video's length. */
@Composable
private fun TileMarks(document: DocumentDto, isStarred: Boolean, modifier: Modifier) {
    Row(modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (isStarred) StarredBadge()
        if (document.kind == DocumentKind.VIDEO) VideoBadge(document.duration_seconds)
    }
}

@Composable
private fun SelectionCover() {
    Box(
        modifier = Modifier.size(TILE).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.32f)),
        contentAlignment = Alignment.Center,
    ) {
        SelectedCheck(Modifier.size(36.dp))
    }
}

/**
 * A document's tile picture: a file as its [FileGridTile]; a photo or video as its thumbnail, or its
 * extension on a plain surface while it has none.
 */
@Composable
internal fun TilePicture(document: DocumentDto, modifier: Modifier = Modifier, size: ThumbnailSize = ThumbnailSize.MD) {
    val thumbnail: @Composable (Modifier) -> Unit = { picture ->
        DocumentThumbnail(
            documentId = document.id,
            mimeType = document.mime_type,
            filename = document.original_filename,
            blurhash = document.thumbnail_blurhash,
            hasThumbnail = true,
            modifier = picture,
            size = size,
        )
    }
    if (document.kind == DocumentKind.FILE) {
        FileGridTile(
            document.mime_type, document.original_filename, document.hasRenderedThumbnail, modifier,
            preview = thumbnail,
        )
        return
    }
    if (!document.hasRenderedThumbnail) {
        Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
            Text(
                fileTypeLabel(document.mime_type, document.original_filename),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }
    thumbnail(modifier)
}

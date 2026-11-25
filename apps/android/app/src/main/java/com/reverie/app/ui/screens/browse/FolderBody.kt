package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.components.Breadcrumb
import com.reverie.app.ui.components.FolderRow

/** What the rows of the folders inside a folder are drawn from, and where they and the breadcrumb lead. */
class FolderLinks(
    val covers: Map<String, FolderCoverDto>,
    val starredIds: Set<String>,
    /** Null opens the Library itself. */
    val onOpen: (folderId: String?) -> Unit,
)

/**
 * A folder page's body, one list: where the folder is, its name and figures, a row per folder inside it, then
 * its own documents by day, photos and videos before the other files. Stateless: the screen hands it the state
 * and what to do, so the same body is drawn in a screenshot or a navigation test.
 *
 * @param name shown as the page's title.
 */
@Composable
fun FolderBody(
    state: FolderState,
    name: String,
    description: String?,
    links: FolderLinks,
    layout: FeedLayout,
    actions: RowActions,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    onLoadMore: () -> Unit,
    error: String?,
    slot: ChromeSlot,
    listState: LazyListState = rememberLazyListState(),
) {
    BoxWithConstraints(slot.modifier.fillMaxSize()) {
        val width = maxWidth.value
        val rows = remember(state, width, layout) { folderRows(state, width, layout) }
        val folders = state.node?.children.orEmpty()
        // The list starts with the title block and the folder rows.
        FeedScrollEffects(
            rows, listState, state.hasMore, onLoadMore, focusedId, onFocusConsumed,
            onHeading = null, leading = 1 + folders.size,
        )
        LazyColumn(state = listState, contentPadding = slot.contentPadding, modifier = Modifier.fillMaxSize()) {
            item(key = "head", contentType = "head") {
                FolderHead(state.path.dropLast(1), name, folderPageMeta(state), description, links.onOpen)
            }
            folderRowItems(folders, links)
            items(rows, key = FeedRow::key, contentType = FeedRow::contentType) { row ->
                FeedRowView(row, actions, layout.today, layout.zone)
            }
            if (rows.isEmpty()) noDocuments(state, error, slot.onUpload)
        }
    }
}

@Composable
private fun FolderHead(
    ancestors: List<FolderWithChildren>,
    name: String,
    meta: String?,
    description: String?,
    onOpen: (String?) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 12.dp)) {
        Breadcrumb(ancestors, onOpen, style = MaterialTheme.typography.bodySmall, endsAtCurrent = false)
        Text(
            name,
            fontSize = 28.sp,
            lineHeight = 34.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { heading() },
        )
        if (meta != null) HeadLine(meta)
        if (!description.isNullOrBlank()) HeadLine(description)
    }
}

@Composable
private fun HeadLine(text: String) {
    Text(
        text,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = 4.dp),
    )
}

private fun LazyListScope.folderRowItems(folders: List<FolderWithChildren>, links: FolderLinks) {
    items(folders, key = { "folder:" + it.id }, contentType = { "folder" }) { folder ->
        FolderRow(
            folder = folder,
            cover = links.covers[folder.id],
            meta = folderMeta(folder),
            onClick = { links.onOpen(folder.id) },
            starred = folder.id in links.starredIds,
        )
    }
}

/** In place of the document rows: a spinner while they are on their way, or that the folder holds nothing. */
private fun LazyListScope.noDocuments(state: FolderState, error: String?, onUpload: () -> Unit) {
    val files = state.files
    val isLoading = isFirstLoad(state.media, error) || files == null || isFirstLoad(files, error)
    if (isLoading) {
        item(key = "loading") {
            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        return
    }
    val hasFolders = !state.node?.children.isNullOrEmpty()
    // A read that failed leaves it unknown whether the folder is empty.
    if (hasFolders || !state.media.fetched || files?.fetched != true) return
    item(key = "empty") {
        Box(Modifier.fillParentMaxHeight(0.7f)) { EmptyList("This folder is empty", PaddingValues(), onUpload) }
    }
}

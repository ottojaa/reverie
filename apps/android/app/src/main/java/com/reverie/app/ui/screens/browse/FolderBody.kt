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
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.settings.FolderView
import com.reverie.app.ui.components.Breadcrumb
import com.reverie.app.ui.screens.manage.RowSelection

/** What a grid keeps between itself and what comes before it. */
private val GRID_TOP_GAP = 4.dp

/** What the folders inside a folder are drawn from, and where they and the breadcrumb lead. */
class FolderLinks(
    val covers: Map<String, FolderCoverDto>,
    val starredIds: Set<String>,
    /** A folder was tapped. */
    val onOpen: (folderId: String) -> Unit,
    /** A breadcrumb step was tapped; null is the root. */
    val onOpenCrumb: (folderId: String?) -> Unit,
    /** The folders' part in the page's selection. */
    val selection: RowSelection = RowSelection(),
)

/**
 * A folder page's body, one scrolling list: where the folder is (the root has nowhere to say), its name and
 * figures, the sort and view controls, the folders inside it, then its own documents. A list draws a row for
 * each folder and document; a grid draws the folders as tiles and the documents as one continuous mosaic.
 * Stateless: the screen hands it the state and what to do, so the same body is drawn in a screenshot or a
 * navigation test.
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
    onSort: (DocumentSort) -> Unit,
    onShowAs: (FolderView) -> Unit,
    error: String?,
    slot: ChromeSlot,
    listState: LazyListState = rememberLazyListState(),
) {
    BoxWithConstraints(slot.modifier.fillMaxSize()) {
        val width = maxWidth.value
        val rows = remember(state, width, layout) { folderRows(state, width, layout) }
        val columns = folderColumns(width)
        // The list starts with the title block and the folders.
        val leading = 1 + folderLineCount(state, columns)
        val hasMore = state.documents.hasMore
        FeedScrollEffects(rows, listState, hasMore, onLoadMore, focusedId, onFocusConsumed, leading)
        // Only a grid in date order has a date to roll by.
        val dated = rows.takeIf { state.view == FolderView.GRID && state.sort == DocumentSort.NEWEST }.orEmpty()
        val dayOf = if (state.filter.isByDateTaken) ::dayTakenOf else ::dayAddedOf
        TopDateEffect(dated, listState, layout, slot.onTopDate, leading, dayOf)
        LazyColumn(state = listState, contentPadding = slot.contentPadding, modifier = Modifier.fillMaxSize()) {
            item(key = "head", contentType = "head") {
                Column {
                    val ancestors = state.path.dropLast(1).takeUnless { state.isRoot }
                    FolderHead(ancestors, name, folderPageMeta(state), description, links.onOpenCrumb)
                    val view = state.view ?: return@Column
                    if (state.children.isEmpty() && state.isEmptyOfDocuments) return@Column
                    FolderControls(state.sort, view, onSort, onShowAs)
                    if (view == FolderView.GRID) Box(Modifier.padding(top = GRID_TOP_GAP))
                }
            }
            folderItems(state, links, columns, width.dp)
            if (state.view != null) documentItems(state, rows, actions, layout)
            if (rows.isEmpty()) noDocuments(state, error, slot.onUpload)
        }
    }
}

@Composable
private fun FolderHead(
    ancestors: List<FolderWithChildren>?,
    name: String,
    meta: String?,
    description: String?,
    onOpenCrumb: (String?) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 8.dp)) {
        if (ancestors != null) {
            Breadcrumb(ancestors, onOpenCrumb, style = MaterialTheme.typography.bodySmall, endsAtCurrent = false)
        }
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

private fun LazyListScope.documentItems(state: FolderState, rows: List<FeedRow>, actions: RowActions, layout: FeedLayout) {
    items(rows, key = { it.key }, contentType = { it.contentType }) { row ->
        when (row) {
            is FeedRow.File -> FolderDocumentRow(row.doc, state.filter, actions, layout)
            else -> FeedRowView(row, actions, layout.today, layout.zone, folderTilePicture)
        }
    }
}

/** In place of the documents: a spinner while they are on their way, or that the folder holds nothing. */
private fun LazyListScope.noDocuments(state: FolderState, error: String?, onUpload: () -> Unit) {
    if (state.view == null || isFirstLoad(state.documents, error)) {
        item(key = "loading") {
            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        return
    }
    // A read that failed leaves it unknown whether the folder is empty.
    if (state.children.isNotEmpty() || !state.documents.fetched) return
    item(key = "empty") {
        Box(Modifier.fillParentMaxHeight(0.7f)) { EmptyList("This folder is empty", PaddingValues(), onUpload) }
    }
}

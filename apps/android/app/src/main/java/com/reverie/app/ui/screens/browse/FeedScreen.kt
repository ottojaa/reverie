package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.screens.manage.pickFrom
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.screens.viewer.returnedDocumentId
import java.time.ZoneId
import java.util.Locale

/**
 * A list of documents as a screen of its own (see [FeedSource]): paged, selectable and swipeable in the
 * viewer.
 *
 * @param onBack null on a screen that is a root, which has no back arrow.
 * @param account the header's avatar button, which only a root has.
 */
@Composable
fun FeedScreen(
    onDocumentClick: (documentId: String, aspect: Float?) -> Unit,
    onBack: (() -> Unit)?,
    onSearch: (SearchScope) -> Unit,
    modifier: Modifier = Modifier,
    account: @Composable () -> Unit = {},
    viewModel: FeedViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val expanded by viewModel.expanded.collectAsStateWithLifecycle()
    val focusedId = returnedDocumentId(viewModel.viewerFocus)
    val layoutMode by viewModel.gridLayoutMode.collectAsStateWithLifecycle()
    val featureEvery by viewModel.mosaicFeatureEvery.collectAsStateWithLifecycle()
    val openDocument = rememberOpenDocument(onDocumentClick)
    val today = rememberToday()
    val zone = remember { ZoneId.systemDefault() }
    val layout = remember(layoutMode, featureEvery, today, zone) { FeedLayout(layoutMode, featureEvery, today, zone) }
    val listState = rememberLazyListState()
    val source = viewModel.source
    val documents = state.documents
    val total by viewModel.total.collectAsStateWithLifecycle()

    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val starredIds = favourites.starredDocumentIds

    val picked = remember(state) { pickFrom(state.selectedIds, documents.documents) }
    val selectedIds = picked.ids
    val actions = remember(viewModel, selectedIds, starredIds) {
        documentRowActions(
            viewModel, selectedIds, starredIds, openDocument,
            onGroupClick = viewModel::tapGroup,
            onGroupLongClick = viewModel::holdGroup,
        )
    }

    BrowseChrome(
        title = BrowseTitle(
            text = source.title,
            subtitle = total?.let(source::subtitle).orEmpty(),
        ),
        ui = ui,
        folderId = null,
        isRefreshing = state.isRefreshing,
        isEmpty = documents.documents.isEmpty(),
        selection = ChromeSelection(picked, viewModel.selection, viewModel::download),
        unlocker = viewModel.unlocker,
        onRefresh = { viewModel.refresh() },
        onRetry = { viewModel.refresh(initial = true) },
        onBack = onBack,
        onOpenDocument = openDocument,
        uploadViewModel = uploadViewModel,
        favourites = viewModel.favourites,
        manage = viewModel.manage,
        modifier = modifier,
        headerActions = {
            SearchAction(source) { onSearch(source.searchScope) }
            account()
        },
    ) { slot ->
        FeedBody(
            source = source,
            state = state,
            expanded = expanded,
            error = ui.error,
            listState = listState,
            layout = layout,
            actions = actions,
            focusedId = focusedId,
            onFocusConsumed = viewModel::clearViewerFocus,
            onLoadMore = viewModel::loadMore,
            slot = slot,
        )
    }
}

@Composable
private fun SearchAction(source: FeedSource, onClick: () -> Unit) {
    val searched = if (source.searchScope is SearchScope.Kind) source.title.lowercase(Locale.ROOT) else "the library"
    IconButton(onClick = onClick) {
        Icon(Icons.Outlined.Search, contentDescription = "Search $searched")
    }
}

/** The list, or its loading skeleton or empty state. */
@Composable
fun FeedBody(
    source: FeedSource,
    state: FeedState,
    expanded: Set<String>,
    error: String?,
    listState: LazyListState,
    layout: FeedLayout,
    actions: RowActions,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    onLoadMore: () -> Unit,
    slot: ChromeSlot,
) {
    val documents = state.documents
    if (isFirstLoad(documents, error)) {
        LoadingGrid(slot.contentPadding)
        return
    }
    if (documents.fetched && documents.documents.isEmpty()) {
        EmptyList(source.emptyTitle, slot.contentPadding, slot.onUpload)
        return
    }
    FeedList(
        source = source,
        documents = documents.documents,
        hasMore = documents.hasMore,
        listState = listState,
        contentPadding = slot.contentPadding,
        layout = layout,
        actions = actions,
        focusedId = focusedId,
        onFocusConsumed = onFocusConsumed,
        onLoadMore = onLoadMore,
        modifier = slot.modifier,
        expanded = expanded,
        onHeading = slot.onHeading,
    )
}

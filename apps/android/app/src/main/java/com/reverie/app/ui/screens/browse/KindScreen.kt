package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.screens.viewer.returnedDocumentId
import java.time.ZoneId

/** One kind of Browse as a screen of its own: Photos, Videos or Files, paged, selectable and swipeable in the viewer. */
@Composable
fun KindScreen(
    onDocumentClick: (documentId: String, aspect: Float?) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    onFavourite: (FavouriteDestination) -> Unit = {},
    viewModel: KindViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val focusedId = returnedDocumentId(viewModel.viewerFocus)
    val layoutMode by viewModel.gridLayoutMode.collectAsStateWithLifecycle()
    val featureEvery by viewModel.mosaicFeatureEvery.collectAsStateWithLifecycle()
    val openDocument = rememberOpenDocument(onDocumentClick)
    val today = rememberToday()
    val zone = remember { ZoneId.systemDefault() }
    val layout = remember(layoutMode, featureEvery, today, zone) { FeedLayout(layoutMode, featureEvery, today, zone) }
    val listState = rememberLazyListState()
    val kind = viewModel.kind
    val documents = state.documents

    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val starredIds = favourites.starredDocumentIds

    val actions = remember(viewModel, state.selectedIds, starredIds) {
        documentRowActions(viewModel, state.selectedIds, starredIds, openDocument)
    }

    BrowseChrome(
        title = BrowseTitle(
            text = kindTitle(kind),
            subtitle = if (documents.fetched) kindSubtitle(kind, documents.total) else "",
            isFolder = false,
            compact = true,
        ),
        ui = ui,
        folderId = null,
        isRefreshing = state.isRefreshing,
        isEmpty = documents.documents.isEmpty(),
        selection = ChromeSelection(state.selectedIds.size, viewModel::clearSelection, viewModel::deleteSelected, viewModel::downloadSelected),
        unlocker = viewModel.unlocker,
        onRefresh = { viewModel.refresh() },
        onRetry = { viewModel.refresh(initial = true) },
        onBack = onBack,
        onOpenDocument = openDocument,
        uploadViewModel = uploadViewModel,
        favourites = viewModel.favourites,
        modifier = modifier,
        onFavourite = onFavourite,
    ) { slot ->
        KindBody(
            kind = kind,
            state = state,
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

/** The kind's list, or its loading skeleton or empty state. */
@Composable
fun KindBody(
    kind: DocumentKind,
    state: FeedState,
    error: String?,
    listState: androidx.compose.foundation.lazy.LazyListState,
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
        EmptyList(emptyTitle(kind), slot.contentPadding, slot.onUpload)
        return
    }
    KindFeed(
        kind = kind,
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
        onHeading = slot.onHeading,
    )
}

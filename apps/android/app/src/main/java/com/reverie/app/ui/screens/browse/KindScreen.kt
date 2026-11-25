package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.upload.UploadViewModel
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
    val focusedId by viewModel.focusedDocumentId.collectAsStateWithLifecycle()
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
        kindRowActions(viewModel, state.selectedIds, starredIds, openDocument)
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
            onFocusConsumed = viewModel::clearFocusedDocument,
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

/** Tap opens (or, once something is selected, selects); long press starts or extends a selection. */
private fun kindRowActions(
    viewModel: KindViewModel,
    selectedIds: Set<String>,
    starredIds: Set<String>,
    openDocument: (DocumentDto) -> Unit,
): RowActions {
    val selecting = selectedIds.isNotEmpty()
    return RowActions(
        selected = { it.id in selectedIds },
        onClick = { doc ->
            if (selecting) {
                viewModel.toggleSelect(doc.id)
            } else {
                // Publish this kind's order so the viewer swipes through it and nothing else.
                viewModel.prepareSequence()
                viewModel.prefetch(doc)
                openDocument(doc)
            }
        },
        onLongClick = { doc -> if (selecting) viewModel.toggleSelect(doc.id) else viewModel.enterSelection(doc.id) },
        starred = { it.id in starredIds },
        onToggleStar = { viewModel.favourites.toggle(FavouriteKey(FavouriteType.DOCUMENT, it.id)) },
    )
}

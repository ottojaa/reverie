package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.screens.viewer.returnedDocumentId
import java.time.ZoneId

/**
 * My Files: picture cards for Photos, Videos and Files over the Recently added list. A card opens its
 * kind as a screen of its own ([onOpenKind]).
 */
@Composable
fun BrowseScreen(
    onDocumentClick: (documentId: String, aspect: Float?) -> Unit,
    onOpenKind: (DocumentKind) -> Unit,
    modifier: Modifier = Modifier,
    onFavourite: (FavouriteDestination) -> Unit = {},
    onSeeAllFavourites: () -> Unit = {},
    viewModel: BrowseViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val focusedId = returnedDocumentId(viewModel.viewerFocus)
    val openDocument = rememberOpenDocument(onDocumentClick)
    val today = rememberToday()
    val zone = remember { ZoneId.systemDefault() }
    // Held by the destination's back-stack entry, so coming back from a kind screen finds the list where it was.
    val listState = rememberLazyListState()
    val latestOnOpenKind by rememberUpdatedState(onOpenKind)
    val selectedIds = state.recent.selectedIds
    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val starredIds = favourites.starredDocumentIds
    val latestOnSeeAll by rememberUpdatedState(onSeeAllFavourites)
    // The strip is re-read each time this screen comes back to the front.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.favourites.load() }

    val actions = remember(viewModel, selectedIds, starredIds) {
        DashboardActions(
            onOpenKind = { latestOnOpenKind(it) },
            recent = recentActions(viewModel, selectedIds, starredIds, openDocument),
            onOpenFavourite = viewModel.favourites::open,
            onSeeAllFavourites = { latestOnSeeAll() },
        )
    }

    BrowseChrome(
        title = BrowseTitle(
            text = "My Files",
            subtitle = state.total?.let(::dashboardSubtitle).orEmpty(),
        ),
        ui = ui,
        folderId = null,
        isRefreshing = state.recent.isRefreshing,
        isEmpty = state.recent.documents.documents.isEmpty(),
        selection = ChromeSelection(selectedIds.size, viewModel::clearSelection, viewModel::deleteSelected, viewModel::downloadSelected),
        unlocker = viewModel.unlocker,
        onRefresh = { viewModel.refresh() },
        onRetry = { viewModel.refresh(initial = true) },
        onBack = null,
        onOpenDocument = openDocument,
        uploadViewModel = uploadViewModel,
        favourites = viewModel.favourites,
        modifier = modifier,
        onFavourite = onFavourite,
    ) { slot ->
        DashboardBody(
            state = state,
            listState = listState,
            contentPadding = slot.contentPadding,
            today = today,
            zone = zone,
            actions = actions,
            focusedId = focusedId,
            onFocusConsumed = viewModel::clearViewerFocus,
            onLoadMore = viewModel::loadMore,
            error = ui.error,
            onUpload = slot.onUpload,
            modifier = slot.modifier,
            favourites = favourites.visible,
        )
    }
}

/** What taps and long presses on Recently added do: open or expand, or (once something is selected) select. */
private fun recentActions(
    viewModel: BrowseViewModel,
    selectedIds: Set<String>,
    starredIds: Set<String>,
    openDocument: (com.reverie.app.data.api.model.DocumentDto) -> Unit,
): RowActions {
    val selecting = selectedIds.isNotEmpty()
    return RowActions(
        selected = { it.id in selectedIds },
        starred = { it.id in starredIds },
        onClick = { doc ->
            if (selecting) {
                viewModel.toggleSelect(listOf(doc.id))
            } else {
                // Publish Recently added's order so the viewer swipes through it, then warm the signed URL and
                // full-res image so it is ready when the dive transition finishes.
                viewModel.prepareSequence()
                viewModel.prefetch(doc)
                openDocument(doc)
            }
        },
        onLongClick = { doc -> if (selecting) viewModel.toggleSelect(listOf(doc.id)) else viewModel.enterSelection(listOf(doc.id)) },
        onGroupClick = { group -> if (selecting) viewModel.toggleSelect(group.docIds()) else viewModel.toggleExpanded(group.key) },
        onGroupLongClick = { group -> if (selecting) viewModel.toggleSelect(group.docIds()) else viewModel.enterSelection(group.docIds()) },
    )
}

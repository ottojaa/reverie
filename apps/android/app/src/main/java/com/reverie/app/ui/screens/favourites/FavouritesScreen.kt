package com.reverie.app.ui.screens.favourites

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.screens.manage.PickingPage
import com.reverie.app.ui.screens.manage.RowSelection
import com.reverie.app.ui.screens.viewer.returnedDocumentId

/** Everything starred, newest first, opened from the Library's Favourites chip. */
@Composable
fun FavouritesScreen(
    onBack: () -> Unit,
    onOpenFolder: (String) -> Unit,
    onDocumentClick: (id: String, aspect: Float?) -> Unit,
    viewModel: FavouritesViewModel = hiltViewModel(),
) {
    val state by viewModel.favourites.state.collectAsStateWithLifecycle()
    val folders by viewModel.folders.collectAsStateWithLifecycle()
    val isFetching by viewModel.isFetching.collectAsStateWithLifecycle()
    val isPulling by viewModel.isPulling.collectAsStateWithLifecycle()
    val focusedId = returnedDocumentId(viewModel.viewerFocus)
    val selectedIds by viewModel.selection.ids.collectAsStateWithLifecycle()
    val picked = remember(state, folders, selectedIds) { pickFavourites(selectedIds, state.visible, folders) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.load() }

    val actions = remember(viewModel, onBack, picked) {
        FavouritesActions(
            onBack = onBack,
            onOpen = viewModel.favourites::open,
            onRefresh = viewModel::pullToRefresh,
            onFocusConsumed = viewModel::clearViewerFocus,
            selection = RowSelection(picked.ids, viewModel.selection::toggle),
        )
    }
    val onGo = { destination: FavouriteDestination ->
        when (destination) {
            is FavouriteDestination.Folder -> onOpenFolder(destination.id)
            is FavouriteDestination.Document -> onDocumentClick(destination.id, destination.aspect)
        }
    }

    PickingPage(picked, viewModel.selection, viewModel.manage, viewModel.favourites, onGo = onGo) {
        FavouritesContent(
            state, folders, actions,
            isFetching = isFetching, isPulling = isPulling, focusedId = focusedId,
        )
    }
}

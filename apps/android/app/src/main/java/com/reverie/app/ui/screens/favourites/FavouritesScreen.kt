package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.manage.ManageHost
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
    val snackbarHostState = remember { SnackbarHostState() }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.load() }

    val actions = remember(viewModel, onBack) {
        FavouritesActions(
            onBack = onBack,
            onOpen = viewModel.favourites::open,
            onUnstar = { viewModel.favourites.toggle(it.key, confirm = true) },
            onHoldFolder = viewModel.manage::openMenu,
            onRefresh = viewModel::pullToRefresh,
            onFocusConsumed = viewModel::clearViewerFocus,
        )
    }

    Box(Modifier.fillMaxSize()) {
        FavouritesContent(
            state, folders, actions,
            isFetching = isFetching, isPulling = isPulling, focusedId = focusedId,
        )
        ReverieSnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomBarInset()))
    }
    FavouriteHost(viewModel.favourites, snackbarHostState) { destination ->
        when (destination) {
            is FavouriteDestination.Folder -> onOpenFolder(destination.id)
            is FavouriteDestination.Document -> onDocumentClick(destination.id, destination.aspect)
        }
    }
    ManageHost(viewModel.manage, snackbarHostState)
}

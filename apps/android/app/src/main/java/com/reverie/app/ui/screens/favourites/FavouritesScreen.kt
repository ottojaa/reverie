package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.navigation.bottomBarInset

/** Everything starred, newest first, behind Collections' shelf and the Files strip. */
@Composable
fun FavouritesScreen(
    onBack: () -> Unit,
    onGo: (FavouriteDestination) -> Unit,
    viewModel: FavouritesViewModel = hiltViewModel(),
) {
    val state by viewModel.favourites.state.collectAsStateWithLifecycle()
    val isFetching by viewModel.isFetching.collectAsStateWithLifecycle()
    val isPulling by viewModel.isPulling.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(FavouriteFilter.ALL) }
    val snackbarHostState = remember { SnackbarHostState() }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.load() }

    val actions = remember(viewModel, onBack) {
        FavouritesActions(
            onBack = onBack,
            onFilter = { filter = it },
            onOpen = viewModel.favourites::open,
            onUnstar = { viewModel.favourites.toggle(it.key) },
            onRefresh = viewModel::pullToRefresh,
        )
    }

    Box(Modifier.fillMaxSize()) {
        FavouritesContent(state, filter, actions, isFetching = isFetching, isPulling = isPulling)
        ReverieSnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomBarInset()))
    }
    FavouriteHost(viewModel.favourites, snackbarHostState, onGo)
}

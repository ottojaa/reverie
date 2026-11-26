package com.reverie.app.ui.screens.privatefolders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.favourites.FavouriteDeps
import com.reverie.app.ui.screens.manage.ManageController
import com.reverie.app.ui.screens.manage.Selection
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Every folder marked private itself, at any depth, parents first. A private folder inside one that is
 * still locked is not known, so it appears once that lock is open.
 */
internal fun privateFolders(tree: List<FolderWithChildren>): List<FolderWithChildren> =
    FolderTree(tree).all().filter { it.is_private }

@HiltViewModel
class PrivateFoldersViewModel @Inject constructor(private val deps: FavouriteDeps) : ViewModel() {

    val favourites = FavouriteController(deps, viewModelScope)

    /** The folders selected. */
    val selection = Selection()

    /** Changing what is selected. */
    val manage = ManageController(deps.folders, deps.documents, deps.vault, favourites, viewModelScope)

    /** The private folders as cached; null until the cache has been read. */
    val folders: StateFlow<List<FolderWithChildren>?> = deps.folders.observeTree()
        .map { privateFolders(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _isPulling = MutableStateFlow(false)
    val isPulling: StateFlow<Boolean> = _isPulling.asStateFlow()

    /** Refetch quietly, on opening the screen and on returning to it. */
    fun load() {
        viewModelScope.launch { fetch() }
    }

    /** The pull-to-refresh gesture: the same fetch, with the spinner. */
    fun pullToRefresh() {
        if (_isPulling.value) return
        viewModelScope.launch {
            _isPulling.value = true
            fetch()
            _isPulling.value = false
        }
    }

    /** The folder tree, and the favourites that mark its rows. Offline, what is cached stays. */
    private suspend fun fetch(): Unit = coroutineScope {
        launch { runCatching { deps.folders.refresh() } }
        favourites.refresh()
    }
}

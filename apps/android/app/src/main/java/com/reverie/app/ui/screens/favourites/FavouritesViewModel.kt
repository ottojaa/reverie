package com.reverie.app.ui.screens.favourites

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.domain.CachedFolders
import com.reverie.app.ui.screens.manage.ManageController
import com.reverie.app.ui.screens.viewer.ViewerFocus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FavouritesViewModel @Inject constructor(private val deps: FavouriteDeps) : ViewModel() {

    val favourites = FavouriteController(deps, viewModelScope)

    /** Folder menus, and moving folders. */
    val manage = ManageController(deps.folders, deps.documents, deps.vault, favourites, viewModelScope)

    val folders: StateFlow<CachedFolders> = deps.folders.observeCached()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CachedFolders())

    private val _isFetching = MutableStateFlow(false)

    /** A fetch this screen asked for is on its way. */
    val isFetching: StateFlow<Boolean> = _isFetching.asStateFlow()

    private val _isPulling = MutableStateFlow(false)
    val isPulling: StateFlow<Boolean> = _isPulling.asStateFlow()

    /** What the viewer is showing, so the screen can scroll to it on return. */
    val viewerFocus: StateFlow<ViewerFocus?> get() = deps.sequences.focus

    /** Consume the focus signal once the list has scrolled to it. */
    fun clearViewerFocus() = deps.sequences.setFocus(null)

    /** Refetch quietly, on opening the screen and on returning to it. */
    fun load() {
        viewModelScope.launch {
            _isFetching.value = true
            fetch()
            _isFetching.value = false
        }
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

    /** The list, and the folder tree its folder rows read. Offline, what is cached stays. */
    private suspend fun fetch(): Unit = coroutineScope {
        launch { runCatching { deps.folders.refresh() } }
        favourites.refresh()
    }
}

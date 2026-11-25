package com.reverie.app.ui.screens.favourites

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FavouritesViewModel @Inject constructor(deps: FavouriteDeps) : ViewModel() {

    val favourites = FavouriteController(deps, viewModelScope)

    private val _isFetching = MutableStateFlow(false)

    /** A fetch this screen asked for is on its way. */
    val isFetching: StateFlow<Boolean> = _isFetching.asStateFlow()

    private val _isPulling = MutableStateFlow(false)
    val isPulling: StateFlow<Boolean> = _isPulling.asStateFlow()

    /** Refetch quietly, on opening the screen and on returning to it. */
    fun load() {
        viewModelScope.launch {
            _isFetching.value = true
            favourites.refresh()
            _isFetching.value = false
        }
    }

    /** The pull-to-refresh gesture: the same fetch, with the spinner. */
    fun pullToRefresh() {
        if (_isPulling.value) return
        viewModelScope.launch {
            _isPulling.value = true
            favourites.refresh()
            _isPulling.value = false
        }
    }
}

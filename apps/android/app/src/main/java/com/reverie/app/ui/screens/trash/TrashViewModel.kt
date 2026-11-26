package com.reverie.app.ui.screens.trash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.data.repository.TrashRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.ui.components.LockedActions
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val LOAD_FAILED = "Couldn't load the trash."
private const val CHANGE_FAILED = "Couldn't save the change."

data class TrashUiState(
    /** Null while it is being read, and when it could not be. */
    val listing: TrashListDto? = null,
    val error: String? = null,
    val isPulling: Boolean = false,
)

/** What the user is being offered, or asked, about one item. */
sealed interface TrashDialog {
    data class Menu(val item: TrashItem) : TrashDialog

    data class ConfirmPurge(val item: TrashItem) : TrashDialog
}

@HiltViewModel
class TrashViewModel @Inject constructor(
    private val trash: TrashRepository,
    vault: VaultRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TrashUiState())
    val uiState: StateFlow<TrashUiState> = _uiState.asStateFlow()

    private val _dialog = MutableStateFlow<TrashDialog?>(null)
    val dialog: StateFlow<TrashDialog?> = _dialog.asStateFlow()

    private val messages = Channel<String>(Channel.BUFFERED)

    /** One-off messages for the screen's snackbar. */
    val notices: Flow<String> = messages.receiveAsFlow()

    private val locked = LockedActions(vault, viewModelScope, CHANGE_FAILED, onFailure = { messages.send(it) })
    val unlocker get() = locked.unlocker

    private var loading: Job? = null

    init {
        // An opened lock shows what its folder is called and holds.
        viewModelScope.launch { vault.unlocks.collect { load() } }
    }

    /** Reads the trash again; a read already under way is dropped for this one. */
    fun load() {
        loading?.cancel()
        loading = viewModelScope.launch { fetch() }
    }

    /** The pull-to-refresh gesture: the same read, with the spinner. */
    fun pullToRefresh() {
        _uiState.update { it.copy(isPulling = true) }
        load()
    }

    /** A tap or hold on an item: a locked folder asks for its password, anything else offers what can be done. */
    fun open(item: TrashItem) {
        if (item is TrashItem.Folder && item.folder.locked) return locked.unlock(item.id)
        _dialog.value = TrashDialog.Menu(item)
    }

    fun askToPurge(item: TrashItem) {
        _dialog.value = TrashDialog.ConfirmPurge(item)
    }

    fun dismiss() {
        _dialog.value = null
    }

    fun restore(item: TrashItem) = change("Restored") { trash.restore(item.toSelection()) }

    fun purge(item: TrashItem) = change("Deleted for good") { trash.purge(item.toSelection()) }

    private fun change(done: String, send: suspend () -> Unit) {
        dismiss()
        locked.attempt {
            send()
            load()
            messages.send(done)
        }
    }

    private suspend fun fetch() {
        try {
            val listing = trash.list()
            _uiState.value = TrashUiState(listing = listing)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _uiState.value = TrashUiState(error = (e as? ReverieApiException)?.userMessage() ?: LOAD_FAILED)
        }
    }
}

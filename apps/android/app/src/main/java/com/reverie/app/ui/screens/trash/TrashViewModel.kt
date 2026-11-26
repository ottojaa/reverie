package com.reverie.app.ui.screens.trash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.data.repository.TrashRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.ui.components.LockedActions
import com.reverie.app.ui.screens.manage.Selection
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

private const val LOAD_FAILED = "Couldn't load Trash."
private const val CHANGE_FAILED = "Couldn't save the change."

data class TrashUiState(
    /** Null while it is being read, and when it could not be. */
    val listing: TrashListDto? = null,
    val error: String? = null,
    val isPulling: Boolean = false,
)

/** What the user is being offered about one item, or asked before items are deleted for good. */
sealed interface TrashDialog {
    data class Menu(val item: TrashItem) : TrashDialog

    data class ConfirmPurge(val items: List<TrashItem>) : TrashDialog
}

@HiltViewModel
class TrashViewModel @Inject constructor(
    private val trash: TrashRepository,
    vault: VaultRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TrashUiState())
    val uiState: StateFlow<TrashUiState> = _uiState.asStateFlow()

    /** The items selected. */
    val selection = Selection()

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

    /** A tap on an item: a locked folder asks for its password, anything else offers what can be done. */
    fun open(item: TrashItem) {
        if (item is TrashItem.Folder && item.folder.locked) return locked.unlock(item.id)
        _dialog.value = TrashDialog.Menu(item)
    }

    fun askToPurge(items: List<TrashItem>) {
        _dialog.value = TrashDialog.ConfirmPurge(items)
    }

    fun dismiss() {
        _dialog.value = null
    }

    fun restore(items: List<TrashItem>) = change("Restored", items) { trash.restore(items.toSelection()) }

    fun purge(items: List<TrashItem>) = change("Deleted for good", items) { trash.purge(items.toSelection()) }

    private fun change(done: String, items: List<TrashItem>, send: suspend () -> Unit) {
        dismiss()
        locked.attempt {
            send()
            selection.remove(items.map { it.id })
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

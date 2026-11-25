package com.reverie.app.data.repository

import com.reverie.app.data.api.FavouritesApi
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The one favourites store every screen reads, fed by GET /favourites. Memory only, never written
 * to disk. Refetches after a folder unlock and after documents are deleted; screens ask for the
 * rest. Logout [clear]s it.
 */
@Singleton
class FavouritesRepository @Inject constructor(
    private val api: FavouritesApi,
    vault: VaultRepository,
    documents: DocumentRepository,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(FavouritesState())
    val state: StateFlow<FavouritesState> = _state.asStateFlow()

    // One fetch and one write at a time: an older answer must not land on top of a newer one.
    private val fetches = Mutex()
    private val writes = Mutex()

    init {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            merge(vault.unlocks, documents.contentChanges).collect { requestRefresh() }
        }
    }

    /** Fetch the list. Throws on failure, leaving what is shown as it was. */
    suspend fun refresh() {
        val session = _state.value.session
        fetches.withLock {
            if (_state.value.session != session) return
            val seen = _state.value.confirmed
            val items = api.list()
            updateIn(session) { state ->
                // The list was asked for after these writes, so it speaks for them now.
                state.copy(items = items, confirmed = state.confirmed.filterNot { (key, edit) -> seen[key] === edit })
            }
        }
    }

    /** [refresh] in the background; a failure (offline) keeps the last list. */
    fun requestRefresh() {
        scope.launch { runCatching { refresh() } }
    }

    /**
     * Show [key] as starred (or not) at once, then tell the server. A failure takes the change back
     * and throws. The write outlives the caller, so leaving the screen does not cancel it.
     */
    suspend fun setStarred(key: FavouriteKey, isStarred: Boolean) {
        val edit = FavouriteEdit(key, isStarred)
        val session = _state.value.session
        _state.update { it.copy(pending = it.pending + edit) }
        // Started at once, so writes queue on the lock in the order the taps came.
        scope.async(start = CoroutineStart.UNDISPATCHED) { write(edit, session) }.await()
    }

    fun clear() {
        _state.update { FavouritesState(session = it.session + 1) }
    }

    private suspend fun write(edit: FavouriteEdit, session: Int) {
        writes.withLock {
            if (_state.value.session != session) return
            try {
                api.set(edit.key, edit.isStarred)
                updateIn(session) { it.copy(pending = it.pending - edit, confirmed = it.confirmed + (edit.key to edit)) }
            } finally {
                // Takes the change back if the write did not go through (a no-op after a successful one).
                updateIn(session) { it.copy(pending = it.pending - edit) }
            }
        }
        // A newly starred item has no card until the list says what it looks like.
        if (edit.isStarred) requestRefresh()
    }

    private fun updateIn(session: Int, change: (FavouritesState) -> FavouritesState) {
        _state.update { if (it.session == session) change(it) else it }
    }
}

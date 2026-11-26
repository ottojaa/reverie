package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FavouritesRepository
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.screens.viewer.DocumentSequence
import com.reverie.app.ui.screens.viewer.DocumentSequenceHolder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Where tapping a favourite leads. */
sealed interface FavouriteDestination {
    data class Folder(val id: String) : FavouriteDestination

    /** [aspect] sizes the opening transition; null for a private document, which arrives without it. */
    data class Document(val id: String, val aspect: Float?) : FavouriteDestination
}

sealed interface FavouriteEvent {
    /** [isConfirmation] marks "added" / "removed", as opposed to a failure. */
    data class Message(val text: String, val isConfirmation: Boolean = false) : FavouriteEvent

    data class Go(val destination: FavouriteDestination) : FavouriteEvent
}

/** Everything a [FavouriteController] reads from, bundled so each view model injects one thing. */
@Singleton
class FavouriteDeps @Inject constructor(
    val favourites: FavouritesRepository,
    val vault: VaultRepository,
    val documents: DocumentRepository,
    val folders: FolderRepository,
    val sequences: DocumentSequenceHolder,
)

/**
 * Starring and opening favourites, the same for every screen that does either: one per view model.
 * It owns the password prompt for the locks those actions run into, and reports through [events].
 */
class FavouriteController(
    private val deps: FavouriteDeps,
    private val scope: CoroutineScope,
) {
    val state: StateFlow<FavouritesState> = deps.favourites.state

    private val eventChannel = Channel<FavouriteEvent>(Channel.BUFFERED)
    val events: Flow<FavouriteEvent> = eventChannel.receiveAsFlow()

    private var afterUnlock: (suspend () -> Unit)? = null

    val unlocker = FolderUnlocker(deps.vault, scope) {
        val action = afterUnlock
        afterUnlock = null
        action?.invoke()
    }

    /** Fetch the list in the background. */
    fun load() = deps.favourites.requestRefresh()

    /** Fetch the list and wait for it, for a pull-to-refresh spinner. A failure keeps the last list. */
    suspend fun refresh() {
        runCatching { deps.favourites.refresh() }
    }

    /** Star [key], or unstar it if it is starred. [confirm] also reports success. */
    fun toggle(key: FavouriteKey, confirm: Boolean = false) =
        setStarred(listOf(key), !state.value.isStarred(key), confirm)

    /** Star every one of [keys], or unstar them all when all are starred already; one notice for the lot. */
    fun toggleAll(keys: List<FavouriteKey>) {
        val isStarred = !keys.all(state.value::isStarred)
        setStarred(keys.filter { state.value.isStarred(it) != isStarred }, isStarred, confirm = true)
    }

    /** Open a favourite; one behind a closed lock asks for the password first. */
    fun open(item: FavouriteDto) {
        val lockId = item.lockId
        if (!item.locked || lockId == null) {
            scope.launch { go(item) }
            return
        }
        askToUnlock(lockId) {
            // A folder that was locked arrived without the folders inside it.
            runCatching { deps.folders.refresh() }
            go(item)
        }
    }

    fun dismissUnlock() {
        afterUnlock = null
        unlocker.dismiss()
    }

    /**
     * One request per item, as there is no batch one; each shows at once. Behind a closed lock the password is
     * asked once for it, and what was refused is tried again.
     */
    private fun setStarred(keys: List<FavouriteKey>, isStarred: Boolean, confirm: Boolean) {
        if (keys.isEmpty()) return
        scope.launch {
            val refused = keys.map { key -> async { refusal(key, isStarred)?.let { key to it } } }.awaitAll().filterNotNull()
            val lockedId = refused.firstNotNullOfOrNull { (_, error) -> (error as? ReverieApiException)?.lockedFolderId() }
            if (lockedId != null) {
                askToUnlock(lockedId) { setStarred(refused.map { (key, _) -> key }, isStarred, confirm) }
                return@launch
            }
            if (refused.isNotEmpty()) return@launch report(if (isStarred) ADD_FAILED else REMOVE_FAILED)
            if (confirm) report(if (isStarred) ADDED else REMOVED, isConfirmation = true)
        }
    }

    /** Why the server did not take one write, or null once it has. */
    private suspend fun refusal(key: FavouriteKey, isStarred: Boolean): Exception? =
        try {
            deps.favourites.setStarred(key, isStarred)
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            e
        }

    private fun askToUnlock(lockId: String, then: suspend () -> Unit) {
        afterUnlock = then
        unlocker.request(lockId)
    }

    private fun report(text: String, isConfirmation: Boolean = false) {
        eventChannel.trySend(FavouriteEvent.Message(text, isConfirmation))
    }

    private fun go(item: FavouriteDto) {
        val destination = when (item.type) {
            FavouriteType.DOCUMENT -> {
                publishSequence(item)
                FavouriteDestination.Document(item.id, item.document?.mediaAspectOrNull())
            }
            FavouriteType.FOLDER -> FavouriteDestination.Folder(item.id)
        }
        eventChannel.trySend(FavouriteEvent.Go(destination))
    }

    /**
     * The viewer swipes through the favourites of the tapped one's section, as they are now, so
     * unstarring one there does not pull its page away; a deleted one still leaves. Private documents
     * stay out of that run, and a private one opens on its own.
     */
    private fun publishSequence(item: FavouriteDto) {
        val ids = if (item.isPrivate) {
            listOf(item.id)
        } else {
            FavouriteSections(state.value.visible.filterNot { it.isPrivate }).sectionOf(item).map { it.id }
        }
        val deletedBefore = deps.documents.deletedIds.value
        val live = deps.documents.deletedIds.map { deleted -> ids - (deleted - deletedBefore) }
        deps.sequences.set(DocumentSequence(initialIds = ids, ids = live, loadMore = {}))
    }

    companion object {
        const val ADDED = "Added to favourites"
        const val REMOVED = "Removed from favourites"
        const val ADD_FAILED = "Couldn't add to favourites."
        const val REMOVE_FAILED = "Couldn't remove from favourites."
    }
}

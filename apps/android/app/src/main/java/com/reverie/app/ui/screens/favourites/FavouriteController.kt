package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Where tapping a favourite leads. */
sealed interface FavouriteDestination {
    data class Folder(val id: String) : FavouriteDestination

    /** The Collections tab, opened at this collection: it holds folders only, so it has no screen of its own. */
    data class Collection(val id: String) : FavouriteDestination

    /** [aspect] sizes the opening transition; null for a private document, which arrives without it. */
    data class Document(val id: String, val aspect: Float?) : FavouriteDestination
}

sealed interface FavouriteEvent {
    /** [isConfirmation] marks "added" / "removed", as opposed to a failure. */
    data class Message(val text: String, val isConfirmation: Boolean = false) : FavouriteEvent

    data class Go(val destination: FavouriteDestination) : FavouriteEvent
}

/** The collection the Collections tab should open next, set from whichever screen asked for it. */
@Singleton
class CollectionFocus @Inject constructor() {
    val requested = MutableStateFlow<String?>(null)
}

/** Everything a [FavouriteController] reads from, bundled so each view model injects one thing. */
@Singleton
class FavouriteDeps @Inject constructor(
    val favourites: FavouritesRepository,
    val vault: VaultRepository,
    val documents: DocumentRepository,
    val folders: FolderRepository,
    val sequences: DocumentSequenceHolder,
    val collectionFocus: CollectionFocus,
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
        setStarred(key, !state.value.isStarred(key), confirm)

    /** Open a favourite; one behind a closed lock asks for the password first. */
    fun open(item: FavouriteDto) {
        val lockId = item.lockId
        if (!item.locked || lockId == null) {
            scope.launch { go(item) }
            return
        }
        askToUnlock(lockId) {
            // A collection that was locked arrived without its folders.
            runCatching { deps.folders.refresh() }
            go(item)
        }
    }

    fun dismissUnlock() {
        afterUnlock = null
        unlocker.dismiss()
    }

    private fun setStarred(key: FavouriteKey, isStarred: Boolean, confirm: Boolean) {
        scope.launch {
            try {
                deps.favourites.setStarred(key, isStarred)
                if (confirm) report(if (isStarred) ADDED else REMOVED, isConfirmation = true)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val lockedId = (e as? ReverieApiException)?.lockedFolderId()
                if (lockedId != null) askToUnlock(lockedId) { setStarred(key, isStarred, confirm) }
                else report(if (isStarred) ADD_FAILED else REMOVE_FAILED)
            }
        }
    }

    private fun askToUnlock(lockId: String, then: suspend () -> Unit) {
        afterUnlock = then
        unlocker.request(lockId)
    }

    private fun report(text: String, isConfirmation: Boolean = false) {
        eventChannel.trySend(FavouriteEvent.Message(text, isConfirmation))
    }

    private suspend fun go(item: FavouriteDto) {
        val destination = when (item.type) {
            FavouriteType.DOCUMENT -> {
                publishSequence(item)
                FavouriteDestination.Document(item.id, item.document?.mediaAspectOrNull())
            }
            FavouriteType.FOLDER -> folderDestination(item)
        }
        eventChannel.trySend(FavouriteEvent.Go(destination))
    }

    /**
     * The viewer swipes through the document favourites as they are now, so unstarring one there
     * does not pull its page away; a deleted one still leaves. Private documents stay out of that
     * run, and a private one opens on its own.
     */
    private fun publishSequence(item: FavouriteDto) {
        val ids = if (item.isPrivate) {
            listOf(item.id)
        } else {
            state.value.visible.filter { it.type == FavouriteType.DOCUMENT && !it.isPrivate }.map { it.id }
        }
        val deletedBefore = deps.documents.deletedIds.value
        val live = deps.documents.deletedIds.map { deleted -> ids - (deleted - deletedBefore) }
        deps.sequences.set(DocumentSequence(initialIds = ids, ids = live, loadMore = {}))
    }

    private suspend fun folderDestination(item: FavouriteDto): FavouriteDestination {
        // A private favourite says nothing about itself; the folder tree knows which kind it is.
        val type = item.folder?.type ?: deps.folders.observeTree().first().typeOf(item.id)
        if (type != FolderType.COLLECTION) return FavouriteDestination.Folder(item.id)
        deps.collectionFocus.requested.value = item.id
        return FavouriteDestination.Collection(item.id)
    }

    private fun List<FolderWithChildren>.typeOf(id: String): FolderType? =
        firstNotNullOfOrNull { node -> if (node.id == id) node.type else node.children.typeOf(id) }

    companion object {
        const val ADDED = "Added to favourites"
        const val REMOVED = "Removed from favourites"
        const val ADD_FAILED = "Couldn't add to favourites."
        const val REMOVE_FAILED = "Couldn't remove from favourites."
    }
}

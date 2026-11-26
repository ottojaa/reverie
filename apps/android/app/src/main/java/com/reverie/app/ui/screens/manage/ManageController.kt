package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.ConflictStrategy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.screens.destination.Destination
import com.reverie.app.ui.screens.destination.DestinationBrowser
import com.reverie.app.ui.screens.destination.DestinationRules
import com.reverie.app.ui.screens.favourites.FavouriteController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

private const val CHANGE_FAILED = "Couldn't save the change."
private const val NO_PASSWORD_NOTICE = "Private folders only lock once your account has a password."

/** What the user is being asked, or offered, about a folder or a move. */
sealed interface ManageDialog {
    data class Menu(val folder: FolderWithChildren, val isStarred: Boolean) : ManageDialog

    data class Rename(val folder: FolderWithChildren) : ManageDialog

    data class ConfirmDelete(val folder: FolderWithChildren) : ManageDialog

    /** Some of the documents about to move have names already [taken] at the destination. */
    data class NameClash(val move: DocumentMove, val taken: List<String>) : ManageDialog
}

/** Documents on their way to another folder; [onMoved] runs once all of them have arrived. */
data class DocumentMove(
    val documents: List<DocumentDto>,
    val destination: Destination,
    val onMoved: () -> Unit,
)

/** What the destination browser was opened to move. */
private sealed interface Picking {
    data class Folder(val folder: FolderWithChildren) : Picking

    data class Documents(val documents: List<DocumentDto>, val onMoved: () -> Unit) : Picking
}

/**
 * Changing folders and moving documents: a folder row's menu, the dialogs that follow from it, and the
 * destination browser. A change a closed lock refuses asks for that folder's password and is then made again.
 */
class ManageController(
    private val folders: FolderRepository,
    private val documents: DocumentRepository,
    private val vault: VaultRepository,
    private val favourites: FavouriteController,
    private val scope: CoroutineScope,
) {
    private val shown = MutableStateFlow<ManageDialog?>(null)
    val dialog: StateFlow<ManageDialog?> = shown.asStateFlow()

    private val messages = Channel<String>(Channel.BUFFERED)

    /** One-off messages for the screen's snackbar. */
    val notices: Flow<String> = messages.receiveAsFlow()

    val browser = DestinationBrowser(folders, vault, scope)
    private var picking: Picking? = null

    private var afterUnlock: (() -> Unit)? = null
    val unlocker = FolderUnlocker(vault, scope) { afterUnlock?.invoke() }

    fun openMenu(folder: FolderWithChildren) =
        show(ManageDialog.Menu(folder, favourites.state.value.isStarred(folder.toKey())))

    fun askToRename(folder: FolderWithChildren) = show(ManageDialog.Rename(folder))

    fun askToDelete(folder: FolderWithChildren) = show(ManageDialog.ConfirmDelete(folder))

    fun dismiss() {
        shown.value = null
    }

    fun toggleFavourite(folder: FolderWithChildren) {
        dismiss()
        favourites.toggle(folder.toKey(), confirm = true)
    }

    fun rename(folderId: String, form: FolderFormData) {
        dismiss()
        val change = UpdateFolderRequest(name = form.name, emoji = form.emoji ?: "", description = form.description ?: "")
        changeFolder { folders.update(folderId, change) }
    }

    fun setPrivate(folderId: String, isPrivate: Boolean) {
        dismiss()
        changeFolder {
            folders.update(folderId, UpdateFolderRequest(is_private = isPrivate))
            // A private folder only locks for an account that has a password.
            if (isPrivate && vault.hasPassword() == false) messages.send(NO_PASSWORD_NOTICE)
        }
    }

    fun delete(folderId: String) {
        dismiss()
        changeFolder { folders.delete(folderId) }
    }

    /** Opens the destination browser for [folder], which cannot go into itself or anything beneath it. */
    fun pickFolderDestination(folder: FolderWithChildren) {
        dismiss()
        picking = Picking.Folder(folder)
        val excluded = FolderTree(listOf(folder)).subtreeIds(folder.id)
        browser.show(DestinationRules(excluded = excluded), startAt = folder.parent_id)
    }

    /** Opens the destination browser for [selected], where they are now if they share a folder. */
    fun pickDocumentDestination(selected: List<DocumentDto>, onMoved: () -> Unit) {
        if (selected.isEmpty()) return
        picking = Picking.Documents(selected, onMoved)
        browser.show(startAt = selected.map { it.folder_id }.distinct().singleOrNull())
    }

    /** The destination browser's choice. */
    fun moveTo(destination: Destination) {
        val chosen = picking ?: return
        picking = null
        when (chosen) {
            is Picking.Folder -> moveFolder(chosen.folder, destination.folderId)
            is Picking.Documents -> checkNames(DocumentMove(chosen.documents, destination, chosen.onMoved))
        }
    }

    /** The answer to a name clash. */
    fun resolveClash(move: DocumentMove, strategy: ConflictStrategy) {
        dismiss()
        send(toMoveBatches(move.documents), move, strategy)
    }

    private fun moveFolder(folder: FolderWithChildren, parentId: String?) {
        if (folder.parent_id == parentId) return
        changeFolder { folders.move(folder.id, parentId) }
    }

    /**
     * Asks about names the destination already holds. A document that is there already stays out of both the
     * question and the move: replacing, the server would trash it as its own namesake.
     */
    private fun checkNames(move: DocumentMove) = attempt {
        val arriving = move.copy(documents = move.documents.filter { it.folder_id != move.destination.folderId })
        if (arriving.documents.isEmpty()) return@attempt
        val taken = documents.takenNames(arriving.destination.folderId, arriving.documents.map { it.original_filename })
        if (taken.isNotEmpty()) return@attempt show(ManageDialog.NameClash(arriving, taken))
        send(toMoveBatches(arriving.documents), arriving, strategy = null)
    }

    /** One request at a time, each retried on its own: a request that went through must never be sent twice. */
    private fun send(batches: List<List<DocumentDto>>, move: DocumentMove, strategy: ConflictStrategy?): Unit = attempt {
        documents.move(batches.first().map { it.id }, move.destination.folderId, strategy)
        val rest = batches.drop(1)
        if (rest.isEmpty()) return@attempt move.onMoved()
        send(rest, move, strategy)
    }

    /** A change to a folder, after which every list reads again. */
    private fun changeFolder(change: suspend () -> Unit) = attempt {
        change()
        documents.announceContentChanged()
    }

    private fun FolderWithChildren.toKey() = FavouriteKey(FavouriteType.FOLDER, id)

    private fun show(next: ManageDialog) {
        shown.value = next
    }

    private fun attempt(action: suspend () -> Unit) {
        scope.launch {
            try {
                action()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val lockedId = (e as? ReverieApiException)?.lockedFolderId()
                if (lockedId == null) {
                    messages.send((e as? ReverieApiException)?.userMessage() ?: CHANGE_FAILED)
                    return@launch
                }
                afterUnlock = { attempt(action) }
                unlocker.request(lockedId, FolderTree(folders.observeTree().first()).find(lockedId)?.name)
            }
        }
    }
}

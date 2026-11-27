package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.model.ConflictStrategy
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.components.LockedActions
import com.reverie.app.ui.screens.destination.Destination
import com.reverie.app.ui.screens.destination.DestinationBrowser
import com.reverie.app.ui.screens.destination.DestinationRules
import com.reverie.app.ui.screens.favourites.FavouriteController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow

private const val CHANGE_FAILED = "Couldn't save the change."
internal const val NO_PASSWORD_NOTICE = "Private folders only lock once your account has a password."

/** What the user is being asked about a folder or a selection. */
sealed interface ManageDialog {
    data class Rename(val folder: FolderWithChildren) : ManageDialog

    data class ConfirmTrash(val picked: Picked, val onGone: (Set<String>) -> Unit) : ManageDialog

    /** Some of the documents about to move have names already [taken] at the destination. */
    data class NameClash(val move: PickedMove, val taken: List<String>) : ManageDialog
}

/** A selection on its way to [destination]; [onGone] hears which selected ids need nothing more. */
data class PickedMove(val picked: Picked, val destination: Destination, val onGone: (Set<String>) -> Unit)

/** What the destination browser was opened to move. */
private data class Picking(val picked: Picked, val onGone: (Set<String>) -> Unit)

/**
 * Changing what is selected (favourites, move, trash) and a folder's name and privacy: the dialogs that
 * ask first, and the destination browser. A change a closed lock refuses opens that folder's lock
 * prompt and is then made again.
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

    private val locked = LockedActions(
        vault, scope, CHANGE_FAILED,
        folderName = { id -> tree().find(id)?.name },
        onFailure = { messages.send(it) },
    )

    /** The unlock prompt for a change a closed lock refused. */
    val unlocker get() = locked.unlocker

    val favouriteState: StateFlow<FavouritesState> get() = favourites.state

    fun askToRename(folder: FolderWithChildren) = show(ManageDialog.Rename(folder))

    fun askToTrash(picked: Picked, onGone: (Set<String>) -> Unit) = show(ManageDialog.ConfirmTrash(picked, onGone))

    fun dismiss() {
        shown.value = null
    }

    /** Stars everything in [picked], or unstars it all when all of it is starred already. */
    fun toggleFavourites(picked: Picked) = favourites.toggleAll(picked.keys)

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
            if (isPrivate && vault.fetchStatus()?.has_password == false) messages.send(NO_PASSWORD_NOTICE)
        }
    }

    fun trash(question: ManageDialog.ConfirmTrash) {
        dismiss()
        attempt {
            val steps = toSteps(question.picked, tree())
            sendInTurn(steps, question.picked.ids, question.onGone) { step -> trashStep(step) }
        }
    }

    /** Opens the destination browser, where [picked] is now if all of it shares a folder. */
    fun pickDestination(picked: Picked, onGone: (Set<String>) -> Unit) {
        val parents = picked.documents.map { it.folderId } + picked.folders.map { it.parent_id }
        if (parents.isEmpty()) return
        picking = Picking(picked, onGone)
        // A folder cannot go into itself or anything beneath it.
        val within = FolderTree(picked.folders)
        val excluded = picked.folders.flatMapTo(mutableSetOf()) { within.subtreeIds(it.id) }
        browser.show(DestinationRules(excluded = excluded), startAt = parents.distinct().singleOrNull())
    }

    /** The destination browser's choice. */
    fun moveTo(destination: Destination) {
        val chosen = picking ?: return
        picking = null
        checkNames(PickedMove(chosen.picked, destination, chosen.onGone))
    }

    /** The answer to a name clash. */
    fun resolveClash(move: PickedMove, strategy: ConflictStrategy) {
        dismiss()
        attempt { send(move, steps(move), strategy) }
    }

    /** Asks about names the destination already holds before anything moves. */
    private fun checkNames(move: PickedMove) = attempt {
        val steps = steps(move)
        val arriving = steps.filterIsInstance<PickedStep.Documents>().flatMap { it.documents }.map { it.filename }
        val taken = if (arriving.isEmpty()) emptyList() else documents.takenNames(move.destination.folderId, arriving)
        if (taken.isNotEmpty()) return@attempt show(ManageDialog.NameClash(move, taken))
        send(move, steps, strategy = null)
    }

    /**
     * What a move has to send. What is at the destination already stays out of it: replacing, the server would
     * trash such a document as its own namesake.
     */
    private suspend fun steps(move: PickedMove): List<PickedStep> {
        val folderId = move.destination.folderId
        return toSteps(move.picked, tree(), { it.folderId != folderId }, { it.parent_id != folderId })
    }

    private fun send(move: PickedMove, steps: List<PickedStep>, strategy: ConflictStrategy?) =
        sendInTurn(steps, move.picked.ids, move.onGone) { step ->
            when (step) {
                is PickedStep.Documents ->
                    documents.move(step.documents.map { it.id }, move.destination.folderId, strategy)
                is PickedStep.Folder -> changing { folders.move(step.folder.id, move.destination.folderId) }
            }
        }

    private suspend fun trashStep(step: PickedStep) = when (step) {
        is PickedStep.Documents -> documents.delete(step.documents.map { it.id })
        is PickedStep.Folder -> changing { folders.delete(step.folder.id) }
    }

    /**
     * Sends the requests one at a time, each retried on its own after an unlock: one that went through must
     * never be sent twice. A refused request stops there, and what it and the later ones hold stays selected.
     */
    private fun sendInTurn(
        steps: List<PickedStep>,
        all: Set<String>,
        onGone: (Set<String>) -> Unit,
        perform: suspend (PickedStep) -> Unit,
    ) {
        // With no request left nothing is left to do, for what needed no request either.
        val step = steps.firstOrNull() ?: return onGone(all)
        attempt {
            perform(step)
            val rest = steps.drop(1)
            if (rest.isNotEmpty()) onGone(step.settles)
            sendInTurn(rest, all, onGone, perform)
        }
    }

    /** A change to a folder, after which every list reads again. */
    private suspend fun changing(change: suspend () -> Unit) {
        change()
        documents.announceContentChanged()
    }

    private fun changeFolder(change: suspend () -> Unit) = attempt { changing(change) }

    private suspend fun tree() = FolderTree(folders.observeTree().first())

    private fun show(next: ManageDialog) {
        shown.value = next
    }

    private fun attempt(action: suspend () -> Unit) = locked.attempt(action)
}

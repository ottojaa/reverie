package com.reverie.app.ui.screens.destination

import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.components.FolderUnlocker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val LOAD_FAILED = "Couldn't load your folders."

/** The state behind one destination browser, which is closed until [show]. */
class DestinationBrowser(
    private val folders: FolderRepository,
    vault: VaultRepository,
    private val scope: CoroutineScope,
) {
    private data class Session(
        val rules: DestinationRules,
        val at: String?,
        val query: String? = null,
        val isRefreshing: Boolean = true,
        val refreshFailed: Boolean = false,
        val error: String? = null,
    )

    private val session = MutableStateFlow<Session?>(null)

    /** Asks for the password when a locked folder is opened, then goes into it. */
    val unlocker = FolderUnlocker(vault, scope) { id ->
        runCatching { folders.refresh() }
        goTo(id)
    }

    /** Null while closed. */
    val state: StateFlow<DestinationState?> = combine(session, folders.observeTree(), folders.covers, ::toState)
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), null)

    fun show(rules: DestinationRules = DestinationRules(), startAt: String? = null) {
        session.value = Session(rules, startAt)
        scope.launch {
            val failed = runCatching { folders.refresh() }.isFailure
            session.update { it?.copy(isRefreshing = false, refreshFailed = failed) }
        }
    }

    fun close() {
        session.value = null
        unlocker.dismiss()
    }

    /** Goes into [folderId], or to the top level for null; a locked folder asks to be unlocked first. */
    fun open(folderId: String?) {
        val folder = folderId?.let { state.value?.tree?.find(it) }
        if (folder?.locked == true) {
            unlocker.request(folder.id, folder.name)
            return
        }
        goTo(folderId)
    }

    fun search(query: String?) {
        session.update { it?.copy(query = query, error = null) }
    }

    /** One step back: out of the search, then up a folder, then closed. */
    fun back() {
        val shown = state.value
        when {
            shown?.query != null -> search(null)
            shown?.current != null -> goTo(shown.current.parent_id)
            else -> close()
        }
    }

    /** Creates a folder where the browser is and goes into it. */
    fun create(form: FolderFormData) {
        val parentId = state.value?.current?.id
        scope.launch {
            val request = CreateFolderRequest(form.name, parentId, form.description, form.emoji)
            val created = attempt("Couldn't create the folder") { folders.create(request) } ?: return@launch
            goTo(created.id)
            if (!form.isPrivate) return@launch
            attempt("Created the folder, but couldn't make it private") {
                folders.update(created.id, UpdateFolderRequest(is_private = true))
            }
        }
    }

    private fun goTo(folderId: String?) {
        session.update { it?.copy(at = folderId, query = null, error = null) }
    }

    private suspend fun <T> attempt(failure: String, block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        val reason = (e as? ReverieApiException)?.userMessage()
        session.update { it?.copy(error = listOfNotNull(failure, reason).joinToString(": ")) }
        null
    }

    private fun toState(session: Session?, tree: List<FolderWithChildren>, covers: Map<String, FolderCoverDto>): DestinationState? {
        session ?: return null
        val folderTree = FolderTree(tree)
        // A folder that is gone, not on offer or locked is not looked into: the top level shows instead.
        val at = session.at?.let(folderTree::find)?.takeIf { session.rules.offers(it) && !it.locked }
        return DestinationState(
            tree = folderTree,
            rules = session.rules,
            at = at?.id,
            query = session.query,
            covers = covers,
            isLoading = tree.isEmpty() && session.isRefreshing,
            error = session.error ?: LOAD_FAILED.takeIf { tree.isEmpty() && session.refreshFailed },
        )
    }
}

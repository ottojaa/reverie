package com.reverie.app.ui.screens.collections

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.VaultUnlockSheet

@Composable
fun CollectionsScreen(
    onOpenFolder: (String) -> Unit,
    modifier: Modifier = Modifier,
    onOpenAllDocuments: () -> Unit = {},
    viewModel: CollectionsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    var showCreateCollection by remember { mutableStateOf(false) }
    var createFolderParentId by remember { mutableStateOf<String?>(null) }
    var editTarget by remember { mutableStateOf<FolderWithChildren?>(null) }
    var deleteTarget by remember { mutableStateOf<FolderWithChildren?>(null) }
    val unlockPrompt by viewModel.unlocker.prompt.collectAsStateWithLifecycle()

    // After a locked folder is unlocked the view model emits its id; step into it.
    LaunchedEffect(viewModel) { viewModel.openFolder.collect(onOpenFolder) }

    // The tree's counts and covers go stale while the user is elsewhere: refetch on every return,
    // which also covers the first open. Tabs are nav destinations, so this fires on tab return too.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refresh() }

    // Making a locked folder public needs its lock open; the view model asks for the password
    // when the server refuses, then repeats the change.
    val actions = remember(viewModel, onOpenFolder, onOpenAllDocuments) {
        CollectionsActions(
            onOpenFolder = { if (it.locked) viewModel.unlock(it) else onOpenFolder(it.id) },
            onUnlock = viewModel::unlock,
            onToggleExpand = viewModel::toggleExpand,
            onNewCollection = { showCreateCollection = true },
            onNewFolder = { createFolderParentId = it },
            onEdit = { editTarget = it },
            onTogglePrivate = { viewModel.setPrivate(it.id, it.name, !it.is_private) },
            onDelete = { deleteTarget = it },
            onOpenAllDocuments = onOpenAllDocuments,
            onFilterChange = viewModel::setFilter,
            onRefresh = viewModel::pullToRefresh,
        )
    }

    CollectionsContent(state = state, actions = actions, modifier = modifier)

    if (showCreateCollection) {
        CreateEditFolderSheet(
            title = "New collection",
            initial = null,
            onSubmit = {
                viewModel.createCollection(it.name, it.emoji, it.description, it.isPrivate)
                showCreateCollection = false
            },
            onDismiss = { showCreateCollection = false },
        )
    }

    createFolderParentId?.let { parentId ->
        CreateEditFolderSheet(
            title = "New folder",
            initial = null,
            onSubmit = {
                viewModel.createFolder(parentId, it.name, it.emoji, it.description, it.isPrivate)
                createFolderParentId = null
            },
            onDismiss = { createFolderParentId = null },
        )
    }

    editTarget?.let { target ->
        CreateEditFolderSheet(
            title = "Edit ${if (target.type == FolderType.COLLECTION) "collection" else "folder"}",
            initial = FolderFormData(target.name, target.emoji, target.description, target.is_private),
            onSubmit = {
                viewModel.edit(target.id, it.name, it.emoji, it.description)
                if (it.isPrivate != target.is_private) viewModel.setPrivate(target.id, it.name, it.isPrivate)
                editTarget = null
            },
            onDismiss = { editTarget = null },
        )
    }

    deleteTarget?.let { target ->
        val isCollection = target.type == FolderType.COLLECTION
        ConfirmDialog(
            title = "Delete ${target.name}?",
            message = if (isCollection) "Its folders will be removed. Documents inside remain but will no longer belong to a folder."
            else "Documents inside remain but will no longer belong to a folder.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = { viewModel.delete(target.id); deleteTarget = null },
            onDismiss = { deleteTarget = null },
        )
    }

    unlockPrompt?.let { prompt ->
        VaultUnlockSheet(
            prompt = prompt,
            onSubmit = viewModel.unlocker::submit,
            onDismiss = viewModel::dismissUnlock,
        )
    }

    state.notice?.let { message ->
        AlertDialog(
            onDismissRequest = viewModel::dismissNotice,
            title = { Text("Set an account password") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = viewModel::dismissNotice) { Text("OK") } },
        )
    }
}

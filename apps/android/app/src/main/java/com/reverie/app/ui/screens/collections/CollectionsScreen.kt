package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.CollectionHeaderRow
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.FolderTreeItem
import com.reverie.app.ui.components.VaultUnlockSheet
import com.reverie.app.ui.components.OfflineBanner
import com.reverie.app.ui.components.StorageSummaryCard

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
    var showVaultUnlock by remember { mutableStateOf(false) }

    // Toggling privacy off on a locked folder would expose it without the password — prompt to
    // unlock instead. Otherwise flip its privacy flag.
    val onTogglePrivate: (FolderWithChildren) -> Unit = { node ->
        if (node.locked) showVaultUnlock = true else viewModel.setPrivate(node.id, !node.is_private)
    }

    Column(modifier = modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
        OfflineBanner(visible = state.isOffline)

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            // No sticky storage footer any more — reserve room for the overlaid bottom nav instead.
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = bottomBarInset() + 16.dp),
        ) {
            item {
                Text(
                    "Library",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                )
            }
            // Storage glance up top — visible but scrolls with the list (not a sticky footer).
            // The full meter lives in Settings.
            if (state.storageQuota > 0) {
                item {
                    StorageSummaryCard(
                        usedBytes = state.storageUsed,
                        quotaBytes = state.storageQuota,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
            item { PrimaryRow(icon = Icons.Outlined.GridView, label = "All Documents", onClick = onOpenAllDocuments) }
            item { CollectionsFilterField(value = state.filter, onValueChange = viewModel::setFilter) }
            item { SectionHeader(onAdd = { showCreateCollection = true }) }

            state.tree.forEach { node ->
                if (node.type == FolderType.COLLECTION) {
                    item(key = node.id) {
                        CollectionHeaderRow(
                            collection = node,
                            expanded = state.isExpanded(node.id),
                            aggregateCount = aggregateCount(node),
                            // Locked collection: tapping prompts to unlock (its folders are hidden
                            // until then) instead of expanding.
                            onToggle = { if (node.locked) showVaultUnlock = true else viewModel.toggleExpand(node.id) },
                            onNewFolder = { createFolderParentId = node.id },
                            onEdit = { editTarget = node },
                            onTogglePrivate = { onTogglePrivate(node) },
                            onDelete = { deleteTarget = node },
                            onUnlock = { showVaultUnlock = true },
                            modifier = Modifier.animateItem(),
                        )
                    }
                    // A locked collection hides its folders until unlocked.
                    if (state.isExpanded(node.id) && !node.locked) {
                        items(node.children, key = { it.id }) { folder ->
                            FolderTreeItem(
                                folder = folder,
                                onOpen = { if (folder.locked) showVaultUnlock = true else onOpenFolder(folder.id) },
                                onEdit = { editTarget = folder },
                                onTogglePrivate = { onTogglePrivate(folder) },
                                onDelete = { deleteTarget = folder },
                                onUnlock = { showVaultUnlock = true },
                                // Extra indent so nested folders read as belonging to the collection.
                                indent = 44.dp,
                                modifier = Modifier.animateItem(),
                            )
                        }
                    }
                } else {
                    item(key = node.id) {
                        FolderTreeItem(
                            folder = node,
                            onOpen = { if (node.locked) showVaultUnlock = true else onOpenFolder(node.id) },
                            onEdit = { editTarget = node },
                            onTogglePrivate = { onTogglePrivate(node) },
                            onDelete = { deleteTarget = node },
                            onUnlock = { showVaultUnlock = true },
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }
    }

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
                if (it.isPrivate != target.is_private) viewModel.setPrivate(target.id, it.isPrivate)
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

    if (showVaultUnlock) {
        VaultUnlockSheet(
            onUnlock = { password, onResult -> viewModel.unlockVault(password, onResult) },
            onDismiss = { showVaultUnlock = false },
        )
    }
}

@Composable
private fun CollectionsFilterField(value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text("Filter collections") },
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                IconButton(onClick = { onValueChange("") }) {
                    Icon(Icons.Outlined.Close, contentDescription = "Clear filter")
                }
            }
        },
        singleLine = true,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

@Composable
private fun PrimaryRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp, horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).padding(start = 12.dp))
        trailing?.invoke()
    }
}

@Composable
private fun SectionHeader(onAdd: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "COLLECTIONS",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .weight(1f)
                .padding(start = 8.dp),
        )
        IconButton(onClick = onAdd) {
            Icon(Icons.Outlined.Add, contentDescription = "New collection", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

private fun aggregateCount(collection: FolderWithChildren): Int =
    collection.document_count + collection.children.sumOf { it.document_count }

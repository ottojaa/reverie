package com.reverie.app.ui.screens.collections

import androidx.compose.runtime.Immutable
import com.reverie.app.data.api.model.FolderWithChildren

/** Everything the Collections list can ask for, so the stateless content takes one parameter. */
@Immutable
class CollectionsActions(
    /** A folder row was tapped: open it, or ask for its password when it is locked. */
    val onOpenFolder: (FolderWithChildren) -> Unit = {},
    val onUnlock: (FolderWithChildren) -> Unit = {},
    val onToggleExpand: (String) -> Unit = {},
    val onNewCollection: () -> Unit = {},
    val onNewFolder: (parentId: String) -> Unit = {},
    val onEdit: (FolderWithChildren) -> Unit = {},
    val onTogglePrivate: (FolderWithChildren) -> Unit = {},
    val onDelete: (FolderWithChildren) -> Unit = {},
    val onOpenAllDocuments: () -> Unit = {},
    val onFilterChange: (String) -> Unit = {},
    val onRefresh: () -> Unit = {},
)

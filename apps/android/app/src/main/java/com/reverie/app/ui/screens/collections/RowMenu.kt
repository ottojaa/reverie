package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.reverie.app.ui.components.FavouriteMenuItem

/** The ⋮ button of a collection or folder row, and the menu it opens. */
@Composable
fun RowMenu(
    isStarred: Boolean,
    onToggleStar: () -> Unit,
    isPrivate: Boolean,
    onNewFolder: (() -> Unit)?,
    onEdit: () -> Unit,
    onTogglePrivate: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    // The Box makes the menu anchor to the button, not to the parent Row.
    Box(modifier) {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Outlined.MoreVert, contentDescription = "Actions", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            RowMenuItems(
                isStarred = isStarred,
                onToggleStar = onToggleStar,
                isPrivate = isPrivate,
                onNewFolder = onNewFolder,
                onEdit = onEdit,
                onTogglePrivate = onTogglePrivate,
                onDelete = onDelete,
                onDone = { open = false },
            )
        }
    }
}

/**
 * The menu's items: the favourite toggle, then New folder (collections only), Edit,
 * Make private / Remove from private and Delete.
 */
@Composable
fun RowMenuItems(
    isStarred: Boolean,
    onToggleStar: () -> Unit,
    isPrivate: Boolean,
    onNewFolder: (() -> Unit)?,
    onEdit: () -> Unit,
    onTogglePrivate: () -> Unit,
    onDelete: () -> Unit,
    onDone: () -> Unit = {},
) {
    FavouriteMenuItem(isStarred, onClick = { onDone(); onToggleStar() })
    HorizontalDivider()
    if (onNewFolder != null) {
        DropdownMenuItem(
            text = { Text("New folder") },
            leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, contentDescription = null) },
            onClick = { onDone(); onNewFolder() },
        )
    }
    DropdownMenuItem(
        text = { Text("Edit") },
        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
        onClick = { onDone(); onEdit() },
    )
    DropdownMenuItem(
        text = { Text(if (isPrivate) "Remove from private" else "Make private") },
        leadingIcon = { Icon(if (isPrivate) Icons.Outlined.LockOpen else Icons.Outlined.Lock, contentDescription = null) },
        onClick = { onDone(); onTogglePrivate() },
    )
    DropdownMenuItem(
        text = { Text("Delete", color = MaterialTheme.colorScheme.error) },
        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
        onClick = { onDone(); onDelete() },
    )
}

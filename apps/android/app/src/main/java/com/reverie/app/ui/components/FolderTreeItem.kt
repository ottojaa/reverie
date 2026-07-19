package com.reverie.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FolderWithChildren

/** A collapsible collection header row with an actions menu. */
@Composable
fun CollectionHeaderRow(
    collection: FolderWithChildren,
    expanded: Boolean,
    aggregateCount: Int,
    onToggle: () -> Unit,
    onNewFolder: () -> Unit,
    onEdit: () -> Unit,
    onTogglePrivate: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rotation by animateFloatAsState(if (expanded) 0f else -90f, label = "chevron")
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Filled.KeyboardArrowDown,
            contentDescription = if (expanded) "Collapse" else "Expand",
            modifier = Modifier.rotate(rotation),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SectionIcon(emoji = collection.emoji, modifier = Modifier.padding(horizontal = 8.dp))
        Text(
            text = collection.name,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (collection.is_private) {
            Icon(Icons.Outlined.Lock, contentDescription = "Private", tint = MaterialTheme.colorScheme.tertiary, modifier = Modifier.size(15.dp))
        }
        Text(
            text = "$aggregateCount",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        TreeItemMenu(
            isPrivate = collection.is_private,
            onNewFolder = onNewFolder,
            onEdit = onEdit,
            onTogglePrivate = onTogglePrivate,
            onDelete = onDelete,
        )
    }
}

/** A folder row nested under a collection. [indent] controls the leading inset for nesting depth. */
@Composable
fun FolderTreeItem(
    folder: FolderWithChildren,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onTogglePrivate: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    indent: Dp = 32.dp,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(start = indent, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionIcon(emoji = folder.emoji, size = 20.dp)
        Text(
            text = folder.name,
            style = MaterialTheme.typography.bodyLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .padding(start = 10.dp),
        )
        if (folder.is_private) {
            Icon(Icons.Outlined.Lock, contentDescription = "Private", tint = MaterialTheme.colorScheme.tertiary, modifier = Modifier.size(14.dp))
        }
        Text(
            text = "${folder.document_count}",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        TreeItemMenu(
            isPrivate = folder.is_private,
            onNewFolder = null,
            onEdit = onEdit,
            onTogglePrivate = onTogglePrivate,
            onDelete = onDelete,
        )
    }
}

@Composable
private fun TreeItemMenu(
    isPrivate: Boolean,
    onNewFolder: (() -> Unit)?,
    onEdit: () -> Unit,
    onTogglePrivate: () -> Unit,
    onDelete: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    // Wrap button + menu in a Box so the menu anchors to the button, not to the parent Row.
    Box {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Outlined.MoreVert, contentDescription = "Actions")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (onNewFolder != null) {
                DropdownMenuItem(
                    text = { Text("New folder") },
                    leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, contentDescription = null) },
                    onClick = { open = false; onNewFolder() },
                )
            }
            DropdownMenuItem(
                text = { Text("Edit") },
                leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                onClick = { open = false; onEdit() },
            )
            DropdownMenuItem(
                text = { Text(if (isPrivate) "Remove from private" else "Make private") },
                leadingIcon = { Icon(if (isPrivate) Icons.Outlined.LockOpen else Icons.Outlined.Lock, contentDescription = null) },
                onClick = { open = false; onTogglePrivate() },
            )
            DropdownMenuItem(
                text = { Text("Delete") },
                leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                onClick = { open = false; onDelete() },
            )
        }
    }
}

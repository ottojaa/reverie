package com.reverie.app.ui.screens.collections

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.SectionIcon

/** One collection: its header line, then its folders in a card, or the locked / empty stand-in. */
@Composable
fun CollectionSection(
    collection: FolderWithChildren,
    covers: Map<String, FolderCoverDto>,
    expanded: Boolean,
    actions: CollectionsActions,
    modifier: Modifier = Modifier,
) {
    val accent = collectionAccent(collection.id).current()

    Column(modifier.padding(top = 18.dp)) {
        CollectionHeader(collection, accent, expanded, actions)
        Box(Modifier.padding(top = 6.dp)) {
            when {
                collection.locked -> LockedCollectionCard(accent, onClick = { actions.onUnlock(collection) })
                !expanded -> Unit
                collection.children.isEmpty() -> AddFolderButton(onClick = { actions.onNewFolder(collection.id) })
                else -> FolderGroupCard(collection.children, covers, actions, accent)
            }
        }
    }
}

@Composable
private fun CollectionHeader(collection: FolderWithChildren, accent: Color, expanded: Boolean, actions: CollectionsActions) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            // A locked collection has nothing to fold away: tapping asks for its password.
            .clickable { if (collection.locked) actions.onUnlock(collection) else actions.onToggleExpand(collection.id) }
            .padding(start = 20.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AccentTile(collection.emoji, accent)
        Row(Modifier.weight(1f).padding(start = 10.dp), verticalAlignment = Alignment.Bottom) {
            Text(
                collection.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Text(
                collectionSubtitle(collection),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                modifier = Modifier.padding(start = 8.dp, bottom = 2.dp),
            )
        }
        PadlockOrChevron(collection, expanded)
        RowMenu(
            isPrivate = collection.is_private,
            onNewFolder = { actions.onNewFolder(collection.id) },
            onEdit = { actions.onEdit(collection) },
            onTogglePrivate = { actions.onTogglePrivate(collection) },
            onDelete = { actions.onDelete(collection) },
        )
    }
}

/** "5 folders", or the lock state when the collection is private (the board's wording). */
internal fun collectionSubtitle(collection: FolderWithChildren): String = when {
    collection.locked -> "Private · locked"
    collection.is_private -> "Private · unlocked"
    collection.children.isEmpty() -> "No folders"
    collection.children.size == 1 -> "1 folder"
    else -> "${collection.children.size} folders"
}

@Composable
private fun PadlockOrChevron(collection: FolderWithChildren, expanded: Boolean) {
    if (collection.locked) {
        Icon(Icons.Outlined.Lock, "Locked, tap to unlock", Modifier.padding(horizontal = 12.dp).size(22.dp), MaterialTheme.colorScheme.tertiary)
        return
    }
    if (collection.is_private) {
        Icon(Icons.Outlined.LockOpen, "Private (unlocked)", Modifier.padding(start = 12.dp).size(20.dp), MaterialTheme.colorScheme.tertiary)
    }
    val rotation by animateFloatAsState(if (expanded) 0f else -90f, label = "chevron")
    Icon(
        Icons.Filled.KeyboardArrowDown,
        contentDescription = if (expanded) "Collapse" else "Expand",
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 4.dp).rotate(rotation),
    )
}

/** The collection's own icon on a tint of its accent. */
@Composable
fun AccentTile(icon: String?, accent: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(30.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(accent.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) {
        SectionIcon(emoji = icon, size = 17.dp, tint = accent)
    }
}

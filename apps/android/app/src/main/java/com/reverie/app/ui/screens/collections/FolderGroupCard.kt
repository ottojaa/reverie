package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.StarIcon

internal val CARD_SHAPE = RoundedCornerShape(18.dp)
internal val ROW_MIN_HEIGHT = 64.dp

/** One rounded card holding a collection's folders (or the root folders), a row each. */
@Composable
fun FolderGroupCard(
    folders: List<FolderWithChildren>,
    covers: Map<String, FolderCoverDto>,
    actions: CollectionsActions,
    accent: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
    starredIds: Set<String> = emptySet(),
) {
    Column(
        modifier
            .padding(horizontal = 20.dp)
            .fillMaxWidth()
            .clip(CARD_SHAPE)
            .background(MaterialTheme.colorScheme.surfaceContainer),
    ) {
        folders.forEachIndexed { index, folder ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.surfaceContainerHighest)
            FolderRow(folder, covers[folder.id], accent, actions, isStarred = folder.id in starredIds)
        }
    }
}

/** A folder: its cover, name, what it holds, and its menu. A locked folder asks for its password instead. */
@Composable
fun FolderRow(
    folder: FolderWithChildren,
    cover: FolderCoverDto?,
    accent: androidx.compose.ui.graphics.Color,
    actions: CollectionsActions,
    modifier: Modifier = Modifier,
    isStarred: Boolean = false,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = ROW_MIN_HEIGHT)
            .clickable { actions.onOpenFolder(folder) }
            .padding(start = 12.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (folder.locked) LockedCover(accent) else CoverMosaic(cover)
        Column(Modifier.weight(1f).padding(start = 12.dp, end = 4.dp)) {
            FolderTitle(folder, isStarred)
            Text(
                text = if (folder.locked) "Locked · Tap to unlock" else folderSubtitle(cover, folder.kind_counts.total),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        RowMenu(
            isStarred = isStarred,
            onToggleStar = { actions.onToggleStar(folder.id) },
            isPrivate = folder.is_private,
            onNewFolder = null,
            onEdit = { actions.onEdit(folder) },
            onTogglePrivate = { actions.onTogglePrivate(folder) },
            onDelete = { actions.onDelete(folder) },
        )
    }
}

@Composable
private fun FolderTitle(folder: FolderWithChildren, isStarred: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = folder.name,
            style = MaterialTheme.typography.bodyLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (isStarred) {
            StarIcon(filled = true, contentDescription = "Favourite", modifier = Modifier.padding(start = 6.dp).size(14.dp))
        }
        if (!folder.is_private) return@Row
        // Private and open: an open padlock says it is readable this session. Closed: a shut one.
        Icon(
            imageVector = if (folder.locked) Icons.Outlined.Lock else Icons.Outlined.LockOpen,
            contentDescription = if (folder.locked) "Locked" else "Private (unlocked)",
            tint = MaterialTheme.colorScheme.tertiary,
            modifier = Modifier.padding(start = 6.dp).size(14.dp),
        )
    }
}

package com.reverie.app.ui.screens.library

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.ui.components.backupIcon
import com.reverie.app.ui.components.backupLine

@Composable
internal fun BackupLine(status: BackupStatus, total: Int?) {
    val text = backupLine(status, total) ?: return
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(backupIcon(status), contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
        Text(text, fontSize = 14.sp, lineHeight = 20.sp, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The shortcut chips as one row that scrolls sideways, ending in the button that reorders them. */
@Composable
internal fun LibraryChips(shortcuts: List<Shortcut>, onReorder: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(start = 20.dp, top = 18.dp, end = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        shortcuts.forEach { key(it.id) { LibraryChip(it) } }
        ReorderButton(onReorder)
    }
}

@Composable
private fun ReorderButton(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Edit,
            contentDescription = "Reorder shortcuts",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun LibraryChip(shortcut: Shortcut) {
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .height(40.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = shortcut.onOpen)
            .padding(start = 12.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(shortcut.icon, contentDescription = null, tint = quiet, modifier = Modifier.size(18.dp))
        Text(shortcut.label, fontSize = 14.sp)
        if (shortcut.count != null) Text(shortcut.count.toString(), fontSize = 14.sp, color = quiet)
    }
}

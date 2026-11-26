package com.reverie.app.ui.screens.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.domain.counted

private val CHIP_SHAPE = RoundedCornerShape(20.dp)

/** "Backup complete · 252 files": where backup stands and how much the library holds. Null: nothing to say yet. */
internal fun backupLine(status: BackupStatus, total: Int?): String? {
    val files = total?.let { counted(it, "file") }

    fun after(state: String) = files?.let { "$it · ${state.replaceFirstChar(Char::lowercase)}" } ?: state

    return when (status) {
        BackupStatus.Unknown -> files
        BackupStatus.Off -> after("Backup off")
        BackupStatus.NotSetUp -> after("Backup not set up")
        BackupStatus.Running -> "Backing up…"
        is BackupStatus.Waiting -> counted(status.count, "file") + " waiting to back up"
        BackupStatus.NeedsAttention -> "Backup needs attention"
        BackupStatus.Complete -> listOfNotNull("Backup complete", files).joinToString(" · ")
    }
}

private fun backupIcon(status: BackupStatus): ImageVector = when (status) {
    BackupStatus.Complete -> Icons.Outlined.CloudDone
    BackupStatus.Running, is BackupStatus.Waiting -> Icons.Outlined.CloudUpload
    BackupStatus.Off, BackupStatus.NotSetUp -> Icons.Outlined.CloudOff
    BackupStatus.NeedsAttention -> Icons.Outlined.ErrorOutline
    BackupStatus.Unknown -> Icons.Outlined.CloudQueue
}

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

private fun smartViewIcon(id: String): ImageVector = when (id) {
    "screenshots" -> Icons.Outlined.Smartphone
    "receipts" -> Icons.Outlined.Receipt
    "statements" -> Icons.AutoMirrored.Outlined.TrendingUp
    "large-files" -> Icons.Outlined.Storage
    else -> Icons.Outlined.Search
}

/** Favourites, the ready-made searches that find something, and the trash, as one row that scrolls sideways. */
@Composable
internal fun LibraryChips(smartViews: List<QuickFilter>, favouriteCount: Int?, links: LibraryLinks) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(start = 20.dp, top = 18.dp, end = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LibraryChip(Icons.Outlined.StarBorder, "Favourites", favouriteCount, links.onOpenFavourites)
        smartViews.forEach { view ->
            LibraryChip(smartViewIcon(view.id), view.label, view.count) { links.onSearch(view.query) }
        }
        LibraryChip(Icons.Outlined.Delete, "Trash", count = null, links.onOpenTrash)
    }
}

@Composable
private fun LibraryChip(icon: ImageVector, label: String, count: Int?, onClick: () -> Unit) {
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .height(40.dp)
            .clip(CHIP_SHAPE)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = onClick)
            .padding(start = 12.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = quiet, modifier = Modifier.size(18.dp))
        Text(label, fontSize = 14.sp)
        if (count != null) Text(count.toString(), fontSize = 14.sp, color = quiet)
    }
}

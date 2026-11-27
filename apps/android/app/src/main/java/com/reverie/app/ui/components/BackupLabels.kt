package com.reverie.app.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.ui.graphics.vector.ImageVector
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.domain.counted

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
        is BackupStatus.NewAlbums -> counted(status.count, "new album") + " not backed up"
        BackupStatus.Complete -> listOfNotNull("Backup complete", files).joinToString(" · ")
    }
}

internal fun backupIcon(status: BackupStatus): ImageVector = when (status) {
    BackupStatus.Complete -> Icons.Outlined.CloudDone
    BackupStatus.Running, is BackupStatus.Waiting -> Icons.Outlined.CloudUpload
    BackupStatus.Off, BackupStatus.NotSetUp -> Icons.Outlined.CloudOff
    BackupStatus.NeedsAttention, is BackupStatus.NewAlbums -> Icons.Outlined.ErrorOutline
    BackupStatus.Unknown -> Icons.Outlined.CloudQueue
}

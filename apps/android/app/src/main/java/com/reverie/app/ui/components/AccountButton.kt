package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.reverie.app.data.backup.BackupStatus

/** The header's way to the account, ringed by where photo backup stands. */
@Composable
fun AccountButton(backup: BackupStatus, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Box(
            modifier = Modifier.size(34.dp).border(2.dp, ringColor(backup), CircleShape).padding(4.dp)
                .clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Person, contentDescription = "Account, backup and settings", modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun ringColor(backup: BackupStatus): Color = when (backup) {
    BackupStatus.Complete, BackupStatus.Running -> MaterialTheme.colorScheme.primary
    BackupStatus.NeedsAttention -> MaterialTheme.colorScheme.error
    is BackupStatus.Waiting -> MaterialTheme.colorScheme.outline
    BackupStatus.Off, BackupStatus.NotSetUp, BackupStatus.Unknown -> MaterialTheme.colorScheme.outlineVariant
}

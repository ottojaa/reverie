package com.reverie.app.ui.screens.settings.backup

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.reverie.app.data.backup.INCLUDE_EXISTING

/** The switches, the backup folder and, while older media is left alone, the way to include it. */
@Composable
internal fun BackupOptionsCard(state: BackupUiState, actions: BackupActions) {
    val settings = state.settings
    BackupCard("Backup") {
        SwitchRow("Back up automatically", "New photos and videos upload on their own, even with the app closed.", settings.enabled, actions.onEnabled)
        ActionRow(
            icon = Icons.Outlined.Folder,
            title = "Backup folder",
            description = "${state.destinations.backupFolder}\n" +
                "Each album gets its own folder in it, unless you choose one for it. Changing it affects new uploads only.",
            action = "Change",
            onClick = actions.onPickFolder,
        )
        if (settings.addedAfter != null && settings.addedAfter != INCLUDE_EXISTING) {
            ActionRow(
                icon = Icons.Outlined.PhotoLibrary,
                title = "Photos already on this phone",
                description = "Only new ones are backed up.",
                action = "Include",
                onClick = actions.onIncludeExisting,
            )
        }
        SwitchRow("Wi-Fi only", "Only back up on an unmetered network.", settings.wifiOnly, actions.onWifiOnly)
    }
}

@Composable
private fun ActionRow(icon: ImageVector, title: String, description: String, action: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(action, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun SwitchRow(title: String, description: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

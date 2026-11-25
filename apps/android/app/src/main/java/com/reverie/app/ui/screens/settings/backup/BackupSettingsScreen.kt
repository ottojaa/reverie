package com.reverie.app.ui.screens.settings.backup

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.data.backup.MediaAccess
import com.reverie.app.data.backup.backupPermissionsToRequest
import com.reverie.app.ui.screens.destination.DestinationPickerDialog
import com.reverie.app.ui.theme.ReverieTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupSettingsScreen(
    onBack: () -> Unit,
    viewModel: BackupViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val askPermissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        viewModel.onPermissionsAnswered()
    }
    // The person may have changed permissions in the system settings and come back.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                windowInsets = WindowInsets(0, 0, 0, 0),
                title = { Text("Photo backup") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            PermissionNotice(state, onAllow = { askPermissions.launch(backupPermissionsToRequest()) })
            StatusCard(state, onBackUpNow = viewModel::backUpNow)
            BackupCard("Backup") {
                SwitchRow("Back up automatically", "New photos and videos upload on their own, even with the app closed.", state.settings.enabled, viewModel::setEnabled)
                DestinationRow(state.settings.folderName, onClick = viewModel::pickDestination)
                SwitchRow("Wi-Fi only", "Only back up on an unmetered network.", state.settings.wifiOnly, viewModel::setWifiOnly)
            }
            AlbumsCard(state.albums, state.selectedBuckets, viewModel::toggleAlbum)
        }
    }

    DestinationPickerDialog(viewModel.destinations, onSelect = viewModel::setDestination)
}

@Composable
private fun PermissionNotice(state: BackupUiState, onAllow: () -> Unit) {
    val context = LocalContext.current
    val openAppSettings = {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
        )
    }
    when {
        state.access == MediaAccess.None -> NoticeCard(
            title = "Allow access to your photos and videos",
            body = "Backup needs to read your photos and videos. Nothing is uploaded until you allow it.",
            action = "Allow access",
            onAction = onAllow,
        )
        state.access == MediaAccess.Limited -> NoticeCard(
            title = "Backup can only see some of your photos",
            body = "You gave Reverie access to selected photos only, so only those can be backed up; the rest of your library is not covered. " +
                "To back up everything, allow access to all photos and videos in the app's permissions.",
            action = "Open app settings",
            onAction = openAppSettings,
        )
        !state.canReadLocation -> NoticeCard(
            title = "Allow access to photo locations",
            body = "Without it, backup stops, because uploads would lose where each photo was taken.",
            action = "Allow location access",
            onAction = onAllow,
        )
    }
}

@Composable
private fun NoticeCard(title: String, body: String, action: String, onAction: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onErrorContainer)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
            OutlinedButton(onClick = onAction) { Text(action) }
        }
    }
}

@Composable
private fun StatusCard(state: BackupUiState, onBackUpNow: () -> Unit) {
    val settings = state.settings
    BackupCard("Status") {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusLine("Last backup", settings.lastSuccessAt?.let(::relativeTime) ?: "Never")
            StatusLine("Waiting to back up", state.pending.toString())
            if (state.parkedVideos > 0) {
                Text(
                    "${state.parkedVideos} large ${if (state.parkedVideos == 1) "video needs" else "videos need"} the app open to finish. " +
                        "Open Reverie and tap Back up now.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            settings.lastError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
            if (!settings.isReady) Text(readinessHint(state), style = MaterialTheme.typography.bodyMedium)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onBackUpNow, enabled = settings.isReady && !state.running && state.access != MediaAccess.None) {
                    Text("Back up now")
                }
                if (state.running) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                    Text("Backing up…", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

private fun readinessHint(state: BackupUiState): String = when {
    state.settings.folderId == null -> "Not set up yet: choose a destination folder to start."
    state.selectedBuckets.isEmpty() -> "Not set up yet: choose at least one album."
    else -> "Backup is off."
}

@Composable
private fun StatusLine(label: String, value: String) {
    Row {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun DestinationRow(folderName: String?, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text("Destination folder", style = MaterialTheme.typography.titleSmall)
            Text(folderName ?: "Choose a folder", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("Change", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun AlbumsCard(albums: List<BackupAlbum>, selected: Set<Long>, onToggle: (Long) -> Unit) {
    BackupCard("Albums") {
        if (albums.isEmpty()) {
            Text("No photos or videos found yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        albums.forEach { album ->
            Row(
                modifier = Modifier.fillMaxWidth().clickable { onToggle(album.bucketId) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = album.bucketId in selected, onCheckedChange = { onToggle(album.bucketId) })
                Text(album.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Text(album.count.toString(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
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

@Composable
private fun BackupCard(title: String, content: @Composable () -> Unit) {
    Column {
        Text(
            title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
        )
        Surface(color = ReverieTheme.cardColor, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) { content() }
        }
    }
}

private fun relativeTime(epochMs: Long): String =
    DateUtils.getRelativeTimeSpanString(epochMs, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()

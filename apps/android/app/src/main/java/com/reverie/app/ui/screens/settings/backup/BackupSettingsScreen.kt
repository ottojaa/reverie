package com.reverie.app.ui.screens.settings.backup

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.backup.MediaAccess
import com.reverie.app.data.backup.backupPermissionsToRequest
import com.reverie.app.ui.screens.destination.DestinationPickerDialog
import com.reverie.app.ui.theme.ReverieTheme

/** What can be done on the backup screen. */
data class BackupActions(
    val onBack: () -> Unit = {},
    val onAllow: () -> Unit = {},
    val onBackUpNow: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    val onEnabled: (Boolean) -> Unit = {},
    val onPickFolder: () -> Unit = {},
    val onIncludeExisting: () -> Unit = {},
    val onWifiOnly: (Boolean) -> Unit = {},
    val onToggleAlbum: (Long) -> Unit = {},
    val onPickAlbumFolder: (Long) -> Unit = {},
    val onResetAlbumFolder: (Long) -> Unit = {},
    val onBackUpNewAlbum: (Long) -> Unit = {},
    val onDismissNewAlbum: (Long) -> Unit = {},
)

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
    var askingAgain by rememberSaveable { mutableStateOf(false) }

    BackupSettingsContent(
        state,
        BackupActions(
            onBack = onBack,
            onAllow = { askPermissions.launch(backupPermissionsToRequest()) },
            onBackUpNow = viewModel::backUpNow,
            onDismissNotice = viewModel::dismissFolderNotice,
            onEnabled = viewModel::setEnabled,
            onPickFolder = viewModel::pickDestination,
            onIncludeExisting = { askingAgain = true },
            onWifiOnly = viewModel::setWifiOnly,
            onToggleAlbum = viewModel::toggleAlbum,
            onPickAlbumFolder = viewModel::pickAlbumFolder,
            onResetAlbumFolder = viewModel::resetAlbumFolder,
            onBackUpNewAlbum = viewModel::backUpNewAlbum,
            onDismissNewAlbum = viewModel::dismissNewAlbum,
        ),
    )

    // The first time, cancelling means "not yet": backup goes off again. Asked again, it changes nothing.
    if (state.needsChoice || askingAgain) {
        BackupChoiceDialog(
            existing = state.leftAlone,
            onOnlyNew = { if (askingAgain) askingAgain = false else viewModel.backUpOnlyNew() },
            onIncludeExisting = {
                askingAgain = false
                viewModel.includeExisting()
            },
            onCancel = { if (askingAgain) askingAgain = false else viewModel.setEnabled(false) },
        )
    }

    DestinationPickerDialog(viewModel.destinations, onSelect = viewModel::setDestination)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupSettingsContent(state: BackupUiState, actions: BackupActions) {
    Scaffold(
        topBar = {
            TopAppBar(
                windowInsets = WindowInsets(0, 0, 0, 0),
                title = { Text("Photo backup") },
                navigationIcon = {
                    IconButton(onClick = actions.onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
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
            PermissionNotice(state, onAllow = actions.onAllow)
            state.newAlbums.forEach { album ->
                NewAlbumNotice(
                    album,
                    onBackUp = { actions.onBackUpNewAlbum(album.bucketId) },
                    onDismiss = { actions.onDismissNewAlbum(album.bucketId) },
                )
            }
            StatusCard(state, actions)
            BackupOptionsCard(state, actions)
            AlbumsCard(state, actions)
        }
    }
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
    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onErrorContainer)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
            OutlinedButton(onClick = onAction) { Text(action) }
        }
    }
}

@Composable
private fun StatusCard(state: BackupUiState, actions: BackupActions) {
    val settings = state.settings
    BackupCard("Status") {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            settings.folderNotice?.let { FolderNotice(it, onDismiss = actions.onDismissNotice) }
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
                Button(onClick = actions.onBackUpNow, enabled = settings.isReady && !state.running && state.access != MediaAccess.None) {
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
    !state.settings.enabled -> "Backup is off."
    state.selectedBuckets.isEmpty() -> "Not set up yet: choose at least one album."
    state.access == MediaAccess.None -> "Not set up yet: allow access to your photos and videos to start."
    else -> "Not set up yet: choose what to back up."
}

@Composable
private fun FolderNotice(text: String, onDismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.weight(1f).padding(vertical = 12.dp),
            )
            IconButton(onClick = onDismiss) {
                Icon(Icons.Outlined.Close, contentDescription = "Dismiss", tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
        }
    }
}

@Composable
private fun StatusLine(label: String, value: String) {
    Row {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
internal fun BackupCard(title: String, content: @Composable () -> Unit) {
    Column {
        Text(
            title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
        )
        Surface(color = ReverieTheme.cardColor, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) { content() }
        }
    }
}

private fun relativeTime(epochMs: Long): String =
    DateUtils.getRelativeTimeSpanString(epochMs, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()

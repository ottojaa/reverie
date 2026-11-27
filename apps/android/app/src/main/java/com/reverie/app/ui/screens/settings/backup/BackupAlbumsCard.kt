package com.reverie.app.ui.screens.settings.backup

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.backup.AlbumProblem
import com.reverie.app.data.backup.BackupAlbum

/**
 * The device's albums, each with a tick. A ticked one says which folder it uploads into, or why it can't;
 * tapping it chooses another folder.
 */
@Composable
internal fun AlbumsCard(state: BackupUiState, actions: BackupActions) {
    BackupCard("Albums") {
        if (state.albums.isEmpty()) {
            Text("No photos or videos found yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@BackupCard
        }
        Text(
            "Tap a ticked album to choose its folder. Changing it affects new photos only; ones already backed up stay where they are.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        state.albums.forEach { AlbumRow(state, it, actions) }
    }
}

@Composable
private fun AlbumRow(state: BackupUiState, album: BackupAlbum, actions: BackupActions) {
    val id = album.bucketId
    val ticked = id in state.selectedBuckets
    val tap = if (ticked) actions.onPickAlbumFolder else actions.onToggleAlbum
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClickLabel = if (ticked) "Choose folder" else "Back up") { tap(id) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = ticked, onCheckedChange = { actions.onToggleAlbum(id) })
        Column(Modifier.weight(1f).padding(vertical = 6.dp, horizontal = 4.dp)) {
            Text(album.name, style = MaterialTheme.typography.bodyLarge)
            if (ticked) AlbumDestination(state, id, onReset = { actions.onResetAlbumFolder(id) })
        }
        Text(album.count.toString(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AlbumDestination(state: BackupUiState, bucketId: Long, onReset: () -> Unit) {
    val isChosen = state.settings.albumFolder(bucketId)?.isChosen == true
    state.destinations.albums[bucketId]?.let {
        Text(
            "To $it",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
    state.settings.albumProblem(bucketId)?.let {
        Text(problemText(it, isChosen), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
    if (isChosen) {
        TextButton(onClick = onReset, contentPadding = PaddingValues(end = 12.dp)) { Text("Reset to default") }
    }
}

/** Why an album isn't backing up and what to do. Only a folder the user chose is ever reported as gone. */
private fun problemText(problem: AlbumProblem, isChosen: Boolean): String = when {
    problem == AlbumProblem.Gone -> "Not backing up: this folder can't be found. Choose another folder."
    isChosen -> "Not backing up: this folder is private and locked. Choose another folder."
    // The lock may be on the backup folder itself, which every album without a folder of its own depends on.
    else -> "Not backing up: this folder is private and locked. Choose another backup folder, or a folder just for this album."
}

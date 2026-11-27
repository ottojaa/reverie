package com.reverie.app.ui.screens.settings.backup

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.backup.BackupAlbum

/** The device's albums, each with a tick; a ticked one says which folder it uploads into. */
@Composable
internal fun AlbumsCard(state: BackupUiState, onToggle: (Long) -> Unit) {
    BackupCard("Albums") {
        if (state.albums.isEmpty()) {
            Text("No photos or videos found yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.albums.forEach { album ->
            val ticked = album.bucketId in state.selectedBuckets
            AlbumRow(album, ticked, state.destinations.albums[album.bucketId].takeIf { ticked }, onToggle = { onToggle(album.bucketId) })
        }
    }
}

@Composable
private fun AlbumRow(album: BackupAlbum, ticked: Boolean, destination: String?, onToggle: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = ticked, onCheckedChange = { onToggle() })
        Column(Modifier.weight(1f).padding(vertical = 4.dp, horizontal = 4.dp)) {
            Text(album.name, style = MaterialTheme.typography.bodyLarge)
            if (destination != null) {
                Text(
                    "To $destination",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(album.count.toString(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

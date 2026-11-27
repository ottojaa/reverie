package com.reverie.app.ui.screens.settings.backup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.domain.counted

/** Says an album has appeared on the phone (or been renamed there) and asks whether to back it up. */
@Composable
internal fun NewAlbumNotice(album: BackupAlbum, onBackUp: () -> Unit, onDismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 8.dp)) {
            Text(
                "New album: ${album.name}, ${contents(album)} — back it up?",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                TextButton(onClick = onDismiss) { Text("Not now") }
                Button(onClick = onBackUp) { Text("Back up") }
            }
        }
    }
}

/** "12 photos", "2 videos" or "10 photos and 2 videos". */
private fun contents(album: BackupAlbum): String {
    val photos = album.count - album.videos
    return listOfNotNull(
        counted(photos, "photo").takeIf { photos > 0 },
        counted(album.videos, "video").takeIf { album.videos > 0 },
    ).joinToString(" and ")
}

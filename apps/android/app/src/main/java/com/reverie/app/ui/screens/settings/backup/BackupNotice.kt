package com.reverie.app.ui.screens.settings.backup

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.domain.counted

/** A button under a notice that does what it proposes. */
internal data class NoticeAction(val label: String, val onClick: () -> Unit)

/** A change of the backup folder to tell about, then each album that has appeared on the phone to ask about. */
@Composable
internal fun BackupNotices(state: BackupUiState, actions: BackupActions) {
    state.settings.folderNotice?.let { BackupNotice(it, onDismiss = actions.onDismissNotice) }
    state.newAlbums.forEach { album ->
        BackupNotice(
            text = newAlbumQuestion(album),
            onDismiss = { actions.onDismissNewAlbum(album.bucketId) },
            action = NoticeAction("Back up") { actions.onBackUpNewAlbum(album.bucketId) },
        )
    }
}

/** Something backup has to say, shown until it is dismissed or its [action] is taken. */
@Composable
private fun BackupNotice(text: String, onDismiss: () -> Unit, action: NoticeAction? = null) {
    val color = MaterialTheme.colorScheme.onSecondaryContainer
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row {
                Text(
                    text,
                    style = MaterialTheme.typography.bodyMedium,
                    color = color,
                    modifier = Modifier.weight(1f).padding(start = 16.dp, top = 14.dp, bottom = 14.dp),
                )
                IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, contentDescription = "Dismiss", tint = color) }
            }
            if (action != null) {
                Button(onClick = action.onClick, modifier = Modifier.align(Alignment.End).padding(end = 16.dp, bottom = 8.dp)) {
                    Text(action.label)
                }
            }
        }
    }
}

private fun newAlbumQuestion(album: BackupAlbum) = "New album: ${album.name}, ${contents(album)} — back it up?"

/** "12 photos", "2 videos" or "10 photos and 2 videos". */
private fun contents(album: BackupAlbum): String {
    val photos = album.count - album.videos
    return listOfNotNull(
        counted(photos, "photo").takeIf { photos > 0 },
        counted(album.videos, "video").takeIf { album.videos > 0 },
    ).joinToString(" and ")
}

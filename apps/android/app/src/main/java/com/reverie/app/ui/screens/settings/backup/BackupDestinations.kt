package com.reverie.app.ui.screens.settings.backup

import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.data.backup.BackupSettings
import com.reverie.app.data.backup.DEFAULT_BACKUP_FOLDER
import com.reverie.app.data.backup.toFolderName
import com.reverie.app.domain.FolderTree

private const val PATH_SEPARATOR = " › "

/** Where backups go, as folder paths under "My files". */
data class BackupDestinations(
    val backupFolder: String = DEFAULT_BACKUP_FOLDER,
    /** Where each album's uploads go, by bucket id. */
    val albums: Map<Long, String> = emptyMap(),
)

/**
 * Names the folders as [tree] has them now, so a rename in Reverie shows here. A folder that isn't
 * made yet, or isn't in the tree yet, is shown as it is going to be called.
 */
fun toBackupDestinations(settings: BackupSettings, albums: List<BackupAlbum>, tree: FolderTree): BackupDestinations {
    val backupPath = tree.pathTo(settings.folderId).map { it.name }
        .ifEmpty { listOf(settings.folderName ?: DEFAULT_BACKUP_FOLDER) }
    val albumPaths = albums.associate { album ->
        val stored = settings.albumFolder(album.bucketId)
        val path = tree.pathTo(stored?.folderId).map { it.name }
            .ifEmpty { backupPath + (stored?.name ?: toFolderName(album.name)) }
        album.bucketId to path.joinToString(PATH_SEPARATOR)
    }
    return BackupDestinations(backupPath.joinToString(PATH_SEPARATOR), albumPaths)
}

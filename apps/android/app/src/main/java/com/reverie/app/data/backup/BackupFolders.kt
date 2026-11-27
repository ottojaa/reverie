package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import javax.inject.Inject
import javax.inject.Singleton

/** The folder made at the top of "My files" when the user hasn't picked a backup folder. */
const val DEFAULT_BACKUP_FOLDER = "Phone backup"

private const val MAX_FOLDER_NAME = 255

/**
 * Where each album's files are uploaded: a subfolder of the backup folder named after the album. The
 * phone remembers it by id, so renaming it in Reverie doesn't lead to a second one. Folders are made
 * when first needed, and again when the server says they are gone.
 */
@Singleton
class BackupFolders @Inject constructor(
    private val settings: BackupSettingsRepository,
    private val transport: BackupTransport,
) {
    /** The folder [bucketId]'s files go into. Throws [ReverieApiException] when it can't be made. */
    suspend fun folderFor(bucketId: Long, albumName: String): String {
        val current = settings.current()
        current.albumFolder(bucketId)?.let { return it.folderId }
        val backupFolder = current.folderId ?: makeBackupFolder(replacing = null, notice = null)
        val name = toFolderName(albumName)
        return try {
            makeAlbumFolder(bucketId, name, backupFolder)
        } catch (e: ReverieApiException.Http) {
            if (e.statusCode != 404) throw e
            // The backup folder itself is gone.
            val remade = makeBackupFolder(replacing = backupFolder, notice = goneNotice(current.folderName))
            makeAlbumFolder(bucketId, name, remade)
        }
    }

    /** Drops [folderId] as [bucketId]'s folder, because the server says it is gone. */
    suspend fun forget(bucketId: Long, folderId: String) = settings.forgetAlbumFolder(bucketId, folderId)

    private suspend fun makeBackupFolder(replacing: String?, notice: String?): String {
        val id = findOrCreate(DEFAULT_BACKUP_FOLDER, parentId = null)
        return settings.adoptBackupFolder(id, DEFAULT_BACKUP_FOLDER, replacing, notice)
    }

    private suspend fun makeAlbumFolder(bucketId: Long, name: String, backupFolder: String): String {
        val id = findOrCreate(name, backupFolder)
        settings.setAlbumFolder(bucketId, AlbumFolder(id, name, madeIn = backupFolder))
        return id
    }

    /**
     * A new folder called [name] in [parentId], or the one already there: sibling names are unique on
     * the server ignoring case, so a reinstall and two albums of one name share a folder.
     */
    private suspend fun findOrCreate(name: String, parentId: String?): String = try {
        transport.createFolder(name, parentId)
    } catch (taken: ReverieApiException.Http) {
        if (taken.statusCode != 409) throw taken
        transport.listFolders(parentId).firstOrNull { it.name.equals(name, ignoreCase = true) }?.id ?: throw taken
    }
}

private fun goneNotice(oldName: String?): String =
    if (oldName == null || oldName.equals(DEFAULT_BACKUP_FOLDER, ignoreCase = true)) {
        "The “$DEFAULT_BACKUP_FOLDER” folder was gone, so it was made again."
    } else {
        "The backup folder “$oldName” is gone, so new uploads go to “$DEFAULT_BACKUP_FOLDER” in My files."
    }

/** [albumName] as a folder name the server accepts. */
internal fun toFolderName(albumName: String): String = albumName
    .replace('/', '-')
    .replace('\\', '-')
    .replace('\u0000', '-')
    .trim()
    .take(MAX_FOLDER_NAME)
    .trim()
    .ifEmpty { "Unnamed album" }

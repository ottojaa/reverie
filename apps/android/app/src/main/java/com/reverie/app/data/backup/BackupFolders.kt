package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import javax.inject.Inject
import javax.inject.Singleton

/** The folder made at the top of "My files" when the user hasn't picked a backup folder. */
const val DEFAULT_BACKUP_FOLDER = "Phone backup"

private const val MAX_FOLDER_NAME = 255

/** The folder of album [bucketId] takes no uploads, as its [AlbumBlock] records: the album waits, the others go on. */
class AlbumBlocked(bucketId: Long) : Exception("Album folder refused uploads: $bucketId")

/**
 * Where each album's files are uploaded: the folder the user chose for it, or else a subfolder of the
 * backup folder named after the album. The phone remembers it by id, so renaming it in Reverie doesn't
 * lead to a second one. Subfolders are made when first needed, and again when the server says they are
 * gone; a chosen folder is never replaced.
 */
@Singleton
class BackupFolders @Inject constructor(
    private val settings: BackupSettingsRepository,
    private val transport: BackupTransport,
) {
    /**
     * Calls [use] with the folder [bucketId]'s files go into. A folder that is locked, or a chosen one that is
     * gone, is recorded against the album and throws [AlbumBlocked]; a subfolder that is gone is made again and
     * [use] tried once more. Otherwise throws [ReverieApiException].
     */
    suspend fun <T> useFolder(bucketId: Long, albumName: String, use: suspend (folderId: String) -> T): T {
        val folder = folderFor(bucketId, albumName)
        return try {
            blockingIfLocked(bucketId, folder.folderId) { use(folder.folderId) }
        } catch (e: ReverieApiException.Http) {
            if (e.statusCode != 404) throw e
            if (folder.isChosen) block(bucketId, folder.folderId, AlbumProblem.Gone)
            settings.forgetAlbumFolder(bucketId, folder.folderId)
            val remade = folderFor(bucketId, albumName).folderId
            blockingIfLocked(bucketId, remade) { use(remade) }
        }
    }

    /**
     * Makes sure [bucketId] has a folder. One the user chose, or one that refused uploads before, is also looked
     * up on the server, so a problem shows without anything to upload and clears once it is over. Throws like [useFolder].
     */
    suspend fun check(bucketId: Long, albumName: String) = useFolder(bucketId, albumName) { folderId ->
        val current = settings.current()
        val inDoubt = current.albumFolder(bucketId)?.isChosen == true || bucketId in current.albumProblems
        if (!inDoubt) return@useFolder
        // The server describes a locked folder itself, rather than refusing the request.
        if (transport.fetchFolder(folderId).locked) block(bucketId, folderId, AlbumProblem.Locked)
        settings.clearAlbumProblem(bucketId)
    }

    /** The folder in force for [bucketId], made first if there is none. Throws like [useFolder]. */
    suspend fun folderFor(bucketId: Long, albumName: String): AlbumFolder {
        val current = settings.current()
        current.albumFolder(bucketId)?.let { return it }
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

    private suspend fun makeBackupFolder(replacing: String?, notice: String?): String {
        val id = findOrCreate(DEFAULT_BACKUP_FOLDER, parentId = null)
        return settings.adoptBackupFolder(id, DEFAULT_BACKUP_FOLDER, replacing, notice)
    }

    private suspend fun makeAlbumFolder(bucketId: Long, name: String, backupFolder: String): AlbumFolder {
        val id = blockingIfLocked(bucketId, backupFolder) { findOrCreate(name, backupFolder) }
        return settings.adoptAlbumFolder(bucketId, AlbumFolder(id, name, madeIn = backupFolder))
    }

    private suspend fun <T> blockingIfLocked(bucketId: Long, folderId: String, call: suspend () -> T): T = try {
        call()
    } catch (e: ReverieApiException.Http) {
        if (!isFolderLocked(e)) throw e
        block(bucketId, folderId, AlbumProblem.Locked)
    }

    private suspend fun block(bucketId: Long, folderId: String, problem: AlbumProblem): Nothing {
        settings.setAlbumProblem(bucketId, AlbumBlock(folderId, problem))
        throw AlbumBlocked(bucketId)
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

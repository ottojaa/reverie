package com.reverie.app.data.backup

import kotlinx.serialization.Serializable

/** The [BackupSettings.addedAfter] that leaves nothing behind: what was already on the phone is backed up too. */
const val INCLUDE_EXISTING = 0L

/** Where one album's files are uploaded. */
@Serializable
data class AlbumFolder(
    val folderId: String,
    val name: String,
    /**
     * The backup folder this subfolder was made in; the entry holds only while that is still the backup folder.
     * Null is a folder the user chose for the album, which holds whatever the backup folder is.
     */
    val madeIn: String? = null,
) {
    val isChosen: Boolean get() = madeIn == null
}

/** Why an album's folder takes no uploads. */
enum class AlbumProblem { Gone, Locked }

/** The folder [folderId] refused an album's uploads. */
@Serializable
data class AlbumBlock(val folderId: String, val problem: AlbumProblem)

/** The server asked at [since] to be left alone for [lengthMs]. */
@Serializable
data class ServerWait(val since: Long, val lengthMs: Long) {
    /** How long is left at [now]; 0 once over, and when the clock was set back to before the wait began. */
    fun left(now: Long): Long = if (now - since in 0 until lengthMs) lengthMs - (now - since) else 0
}

data class BackupSettings(
    val enabled: Boolean = false,
    /** The albums to back up; null until the user (or the Camera default) has chosen. */
    val bucketIds: Set<Long>? = null,
    /** The backup folder, which each album gets a subfolder in; null until one is made or chosen. */
    val folderId: String? = null,
    val folderName: String? = null,
    /**
     * Photos and videos added to the phone before this moment (epoch seconds) are left alone, unless it is
     * [INCLUDE_EXISTING]. Null until the user has chosen.
     */
    val addedAfter: Long? = null,
    /** Each album's folder by bucket id; read it through [albumFolder]. */
    val albumFolders: Map<Long, AlbumFolder> = emptyMap(),
    /** What each album's last refusal was, by bucket id; read it through [albumProblem]. */
    val albumProblems: Map<Long, AlbumBlock> = emptyMap(),
    /**
     * The albums the user has had a chance to tick; any other is new to them. Null until the phone's albums
     * have been looked at once.
     */
    val knownAlbums: Set<Long>? = null,
    /** Something backup did on its own that the user should know about, until they dismiss it. */
    val folderNotice: String? = null,
    val wifiOnly: Boolean = true,
    val lastSuccessAt: Long? = null,
    val lastError: String? = null,
    /** The last "too many requests" from the server, which every pass honours, an app restart in between or not. */
    val serverWait: ServerWait? = null,
    /** Which server and user the ledger belongs to; see [BackupSettingsRepository.setLibraryKey]. */
    val libraryKey: String? = null,
) {
    /** Backup only runs once it is on, knows what to back up and has at least one album. */
    val isReady: Boolean get() = toConfig() != null

    fun toConfig(): BackupConfig? {
        if (!enabled || bucketIds.isNullOrEmpty()) return null
        return addedAfter?.let { BackupConfig(bucketIds, it) }
    }

    /** The folder stored for [bucketId], if it still holds. */
    fun albumFolder(bucketId: Long): AlbumFolder? =
        albumFolders[bucketId]?.takeIf { it.isChosen || it.madeIn == folderId }

    /**
     * What stands in the way of backing up [bucketId]. A refusal counts only while the album is backed up
     * and would still upload into the folder that refused: its own, or else under the backup folder.
     */
    fun albumProblem(bucketId: Long): AlbumProblem? {
        val block = albumProblems[bucketId] ?: return null
        val target = albumFolder(bucketId)?.folderId ?: folderId
        return block.problem.takeIf { bucketId in bucketIds.orEmpty() && block.folderId == target }
    }

    val hasAlbumProblem: Boolean get() = albumProblems.keys.any { albumProblem(it) != null }
}

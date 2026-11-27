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
     * Null holds whatever the backup folder is.
     */
    val madeIn: String? = null,
)

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
    /** Something backup did on its own that the user should know about, until they dismiss it. */
    val folderNotice: String? = null,
    val wifiOnly: Boolean = true,
    val lastSuccessAt: Long? = null,
    val lastError: String? = null,
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
        albumFolders[bucketId]?.takeIf { it.madeIn == null || it.madeIn == folderId }
}

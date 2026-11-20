package com.reverie.app.data.backup

/** One photo or video on the device, as MediaStore lists it. [id] is its `MediaStore.Files` `_ID`. */
data class BackupMedia(
    val id: Long,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val bucketId: Long,
    val bucketName: String = "",
)

/** A device album (MediaStore bucket) and how many photos and videos it holds. */
data class BackupAlbum(val bucketId: Long, val name: String, val count: Int)

/** What a pass needs to know about the user's backup settings. */
data class BackupConfig(
    val bucketIds: Set<Long>,
    val folderId: String,
)

/** How one pass is allowed to run. */
data class BackupRequest(
    val config: BackupConfig,
    /** How long the pass may keep starting new work, in milliseconds. */
    val budgetMs: Long,
    /** The user asked for it: files that failed recently are tried again instead of waiting out their backoff. */
    val userInitiated: Boolean = false,
    /** Also try the large videos that were parked; only sensible once the run is promoted to the foreground. */
    val includeParked: Boolean = false,
    /** True when the run is being stopped because its time is up (as opposed to losing the network or battery). */
    val wasStoppedByTimeout: () -> Boolean = { false },
)

sealed interface PassEnd {
    /** A fresh scan found nothing left to do. */
    data object Completed : PassEnd

    /** The time ran out with files still waiting; the next pass resumes from the ledger. */
    data object OutOfTime : PassEnd

    /** The pass could not go on (signed out, offline, server down, folder gone); [error] says why in plain words. */
    data class Stopped(val error: String) : PassEnd

    /** Another pass already holds the lock, so this one did nothing. */
    data object Busy : PassEnd
}

data class PassResult(
    val end: PassEnd,
    val uploaded: Int = 0,
    val skipped: Int = 0,
    val failed: Int = 0,
    /** The first per-file failure's reason, for the status line. */
    val firstFailure: String? = null,
)

/** The device's albums, biggest first, built from a listing of its [media]. */
fun toAlbums(media: List<BackupMedia>): List<BackupAlbum> = media
    .groupBy { it.bucketId }
    .map { (bucketId, items) -> BackupAlbum(bucketId, items.first().bucketName.ifBlank { "Unnamed album" }, items.size) }
    .sortedByDescending { it.count }

/** The album a phone's camera saves into: preselected the first time backup is set up. */
fun isCameraAlbum(album: BackupAlbum): Boolean = album.name.equals("Camera", ignoreCase = true)

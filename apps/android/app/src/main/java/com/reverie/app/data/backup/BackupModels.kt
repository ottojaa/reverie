package com.reverie.app.data.backup

/** One photo or video on the device, as MediaStore lists it. [id] is its `MediaStore.Files` `_ID`. */
data class BackupMedia(
    val id: Long,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val bucketId: Long,
    val bucketName: String = "",
    /** When the phone's media library got the file, in epoch seconds. */
    val addedAt: Long = 0,
)

/** A device album (MediaStore bucket), how many photos and videos it holds, and how many of those are videos. */
data class BackupAlbum(val bucketId: Long, val name: String, val count: Int, val videos: Int = 0)

/** What a pass needs to know about the user's backup settings. */
data class BackupConfig(
    val bucketIds: Set<Long>,
    /** See [BackupSettings.addedAfter]. */
    val addedAfter: Long,
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
    /** The app may read every photo and video, so the albums it lists are all there are. */
    val seesAllMedia: Boolean = false,
    /** True when the run is being stopped because its time is up (as opposed to losing the network or battery). */
    val wasStoppedByTimeout: () -> Boolean = { false },
)

sealed interface PassEnd {
    /** A fresh scan found nothing left to do. */
    data object Completed : PassEnd

    /** The time ran out with files still waiting; the next pass resumes from the ledger. */
    data object OutOfTime : PassEnd

    /** The pass could not go on (signed out, offline, server down); [error] says why in plain words. */
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
    .map { (bucketId, items) -> toAlbum(bucketId, items) }
    .sortedByDescending { it.count }

private fun toAlbum(bucketId: Long, items: List<BackupMedia>) = BackupAlbum(
    bucketId = bucketId,
    name = items.first().bucketName.ifBlank { "Unnamed album" },
    count = items.size,
    videos = items.count { it.mimeType.startsWith("video/") },
)

/**
 * The albums to tell the user about: not ticked, and never had in front of them. An album renamed on the
 * phone counts, as it comes back under a new id. Nothing is new before albums were ever chosen.
 */
fun newAlbums(albums: List<BackupAlbum>, settings: BackupSettings): List<BackupAlbum> {
    val ticked = settings.bucketIds ?: return emptyList()
    val known = settings.knownAlbums ?: return emptyList()
    return albums.filter { it.bucketId !in known && it.bucketId !in ticked }
}

/** The album a phone's camera saves into: preselected the first time backup is set up. */
fun isCameraAlbum(album: BackupAlbum): Boolean = album.name.equals("Camera", ignoreCase = true)

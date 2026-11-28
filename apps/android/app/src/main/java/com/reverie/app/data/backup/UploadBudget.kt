package com.reverie.app.data.backup

/**
 * The server takes 3600 uploads in 15 minutes from each user, counted apart from the user's other requests
 * (`upload.route.ts`). Backup gives out at most this many upload turns (a file, or a set of identical
 * files) in that time, three quarters of it, so a long run leaves room for the user's own uploads from the
 * phone and the web.
 */
internal const val UPLOADS_PER_WINDOW = 2_700
internal const val UPLOAD_WINDOW_MS = 15 * 60_000L

/** Counts upload turns over a sliding window. Not thread-safe: the runner calls it from its pass only. */
internal class UploadBudget(private val limit: Int = UPLOADS_PER_WINDOW, private val windowMs: Long = UPLOAD_WINDOW_MS) {
    private val starts = ArrayDeque<Long>()

    /** Takes a place for a turn starting at [now] and returns 0, or else how long until there is one. */
    fun take(now: Long): Long {
        // A start "in the future" means the clock was set back; keeping it would hold backup up for that long.
        while (starts.isNotEmpty() && now - starts.first() !in 0 until windowMs) starts.removeFirst()
        if (starts.size >= limit) return starts.first() + windowMs - now
        starts.addLast(now)
        return 0
    }
}

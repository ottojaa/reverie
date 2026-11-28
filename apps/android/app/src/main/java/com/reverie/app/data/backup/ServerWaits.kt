package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException

/** The wait after a "too many requests" that names no time: the length of the server's upload window. */
private const val DEFAULT_WAIT_SECONDS = UPLOAD_WINDOW_MS / 1_000

/** Near the end of its window the server may name next to no time; backup doesn't come back sooner than this. */
private const val MIN_WAIT_SECONDS = 60L

/** Far longer than any limit of the server's: a longer `Retry-After` is a mistake somewhere. */
private const val MAX_WAIT_SECONDS = 24 * 60 * 60L

/** The wait the server asked for with the "too many requests" [e], starting at [now]. */
internal fun toServerWait(e: ReverieApiException, now: Long): ServerWait {
    val asked = (e as? ReverieApiException.Http)?.retryAfterSeconds ?: DEFAULT_WAIT_SECONDS
    return ServerWait(now, asked.coerceIn(MIN_WAIT_SECONDS, MAX_WAIT_SECONDS) * 1_000)
}

/** How a pass ends while a wait the server asked for still holds at [now]; null when none does. */
internal suspend fun BackupSettingsRepository.waitingEnd(now: Long): PassEnd.Stopped? {
    val waitLeft = current().serverWait?.left(now) ?: 0
    if (waitLeft == 0L) return null
    return PassEnd.Stopped("The server asked backup to slow down. It will carry on by itself after a short wait.", waitLeft)
}

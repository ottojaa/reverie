package com.reverie.app.data.backup

import com.reverie.app.data.local.entity.BackupRetryEntity

/** How many times a run may be cut off alone on a file before the file is parked as "needs the app open". */
const val CUT_OFF_PRIORITY = 1
const val CUT_OFF_PARKED = 2

private const val RETRY_BASE_MS = 30 * 60_000L
private const val RETRY_MAX_MS = 6 * 60 * 60_000L

/**
 * The device items in [bucketIds], added at [addedAfter] or later, that the ledger has not handled yet,
 * in [items]' order.
 */
fun scanPending(items: List<BackupMedia>, bucketIds: Set<Long>, ledgerIds: Set<Long>, addedAfter: Long): List<BackupMedia> =
    items.filter { it.bucketId in bucketIds && it.addedAt >= addedAfter && it.id !in ledgerIds }

/**
 * The pending files a pass may work on now, in the order to work on them: anything that was cut off
 * goes first (it gets a full run to itself), the rest keep [pending]'s newest-first order. Files
 * still backing off after a failure wait unless [userInitiated]; parked ones wait unless [includeParked].
 */
fun orderForRun(
    pending: List<BackupMedia>,
    retries: Map<Long, BackupRetryEntity>,
    now: Long,
    userInitiated: Boolean,
    includeParked: Boolean,
): List<BackupMedia> = pending
    .filter { media ->
        val retry = retries[media.id] ?: return@filter true
        if (retry.cutOffs >= CUT_OFF_PARKED && !includeParked) return@filter false
        userInitiated || retry.nextAttemptAt <= now
    }
    .sortedByDescending { retries[it.id]?.cutOffs ?: 0 }

/** When a file that has now failed [failures] times may be tried again: 30 minutes, doubling, capped at 6 hours. */
fun nextAttemptAfter(failures: Int, now: Long): Long {
    val exponent = (failures - 1).coerceIn(0, 10)
    return now + minOf(RETRY_BASE_MS shl exponent, RETRY_MAX_MS)
}

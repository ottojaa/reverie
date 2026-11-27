package com.reverie.app.data.backup

import com.reverie.app.data.local.entity.BackupRetryEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class BackupScanTest {

    private fun media(id: Long, bucket: Long = 1) = BackupMedia(id, "IMG_$id.jpg", "image/jpeg", 1_000, bucket)

    private fun retry(id: Long, failures: Int = 0, cutOffs: Int = 0, next: Long = 0) =
        BackupRetryEntity(id, failures, cutOffs, next, null)

    @Test fun `scan picks only items in the selected albums that the ledger has not handled`() {
        val items = listOf(media(1, bucket = 10), media(2, bucket = 10), media(3, bucket = 20), media(4, bucket = 30))

        val pending = scanPending(items, bucketIds = setOf(10, 30), ledgerIds = setOf(2), addedAfter = INCLUDE_EXISTING)

        assertEquals(listOf(1L, 4L), pending.map { it.id })
    }

    @Test fun `scan with no selected album finds nothing`() {
        assertEquals(emptyList<BackupMedia>(), scanPending(listOf(media(1)), emptySet(), emptySet(), INCLUDE_EXISTING))
    }

    @Test fun `scan leaves alone what was added before the cutoff`() {
        val items = listOf(media(1).copy(addedAt = 99), media(2).copy(addedAt = 100), media(3).copy(addedAt = 101))

        assertEquals(listOf(2L, 3L), scanPending(items, setOf(1), emptySet(), addedAfter = 100).map { it.id })
        assertEquals(listOf(1L, 2L, 3L), scanPending(items, setOf(1), emptySet(), INCLUDE_EXISTING).map { it.id })
    }

    @Test fun `a file cut off before goes first and the rest keep their order`() {
        val pending = listOf(media(1), media(2), media(3))

        val ordered = orderForRun(pending, mapOf(3L to retry(3, cutOffs = 1)), now = 0, userInitiated = false, includeParked = false)

        assertEquals(listOf(3L, 1L, 2L), ordered.map { it.id })
    }

    @Test fun `a failed file waits out its backoff in the background but not when the user asks`() {
        val pending = listOf(media(1), media(2))
        val retries = mapOf(1L to retry(1, failures = 1, next = 5_000))

        val background = orderForRun(pending, retries, now = 1_000, userInitiated = false, includeParked = false)
        val manual = orderForRun(pending, retries, now = 1_000, userInitiated = true, includeParked = false)
        val later = orderForRun(pending, retries, now = 5_000, userInitiated = false, includeParked = false)

        assertEquals(listOf(2L), background.map { it.id })
        assertEquals(listOf(1L, 2L), manual.map { it.id })
        assertEquals(listOf(1L, 2L), later.map { it.id })
    }

    @Test fun `parked files only run when asked to include them`() {
        val pending = listOf(media(1), media(2))
        val retries = mapOf(1L to retry(1, cutOffs = CUT_OFF_PARKED))

        val without = orderForRun(pending, retries, now = 0, userInitiated = true, includeParked = false)
        val with = orderForRun(pending, retries, now = 0, userInitiated = true, includeParked = true)

        assertEquals(listOf(2L), without.map { it.id })
        assertEquals(listOf(1L, 2L), with.map { it.id })
    }

    @Test fun `the retry delay doubles from 30 minutes and stops at 6 hours`() {
        val minute = 60_000L

        assertEquals(30 * minute, nextAttemptAfter(1, now = 0))
        assertEquals(60 * minute, nextAttemptAfter(2, now = 0))
        assertEquals(120 * minute, nextAttemptAfter(3, now = 0))
        assertEquals(360 * minute, nextAttemptAfter(6, now = 0))
        assertEquals(360 * minute, nextAttemptAfter(50, now = 0))
        assertEquals(1_000 + 30 * minute, nextAttemptAfter(1, now = 1_000))
    }

    @Test fun `albums are grouped by bucket, biggest first, and the camera album is recognised`() {
        val items = listOf(
            media(1, 10).copy(bucketName = "Screenshots"),
            media(2, 20).copy(bucketName = "Camera"),
            media(3, 20).copy(bucketName = "Camera"),
        )

        val albums = toAlbums(items)

        assertEquals(listOf("Camera", "Screenshots"), albums.map { it.name })
        assertEquals(listOf(2, 1), albums.map { it.count })
        assertEquals(listOf(true, false), albums.map(::isCameraAlbum))
    }
}

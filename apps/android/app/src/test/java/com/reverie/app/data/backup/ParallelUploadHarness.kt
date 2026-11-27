package com.reverie.app.data.backup

import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import org.junit.Rule
import org.junit.rules.TemporaryFolder

/**
 * A runner on virtual time over uploads that take a while, so they can overlap. What each upload met is
 * recorded: when it started, how many others were in flight then, and the most there ever were.
 */
abstract class ParallelUploadHarness {
    @get:Rule
    val files = TemporaryFolder()

    internal val dao = FakeDao()
    internal val transport = FakeTransport()
    internal var manualUploadRunning = false

    internal val inFlight = mutableSetOf<Long>()
    internal val startedAt = mutableMapOf<Long, Long>()
    internal val startedBeside = mutableMapOf<Long, Int>()
    internal var peak = 0

    internal lateinit var settings: BackupSettingsRepository

    /** Every upload takes [lasting] of virtual time, then does [then] (which may throw). */
    internal fun TestScope.uploadsTake(lasting: (Long) -> Long = { 1_000 }, then: (Long) -> Unit = {}) {
        transport.onUpload = { media ->
            startedAt[media.id] = testScheduler.currentTime
            startedBeside[media.id] = inFlight.size
            inFlight += media.id
            peak = maxOf(peak, inFlight.size)
            try {
                delay(lasting(media.id))
                then(media.id)
            } finally {
                inFlight -= media.id
            }
        }
    }

    internal fun TestScope.runner(
        source: BackupMediaSource,
        over: BackupTransport = transport,
        budget: UploadBudget = UploadBudget(),
    ): BackupRunner {
        settings = settingsRepository(files)
        return BackupRunner(
            source, over, dao, BackupFolders(settings, over), settings,
            ManualUploads { manualUploadRunning }, budget,
        ) { testScheduler.currentTime }
    }

    internal fun photos(count: Int) = FakeSource(List(count) { media(it + 1L) })

    internal fun request(
        parallelUploads: Int = MAX_PARALLEL_UPLOADS,
        budgetMs: Long = 8 * 60_000L,
        timedOut: Boolean = false,
    ) = BackupRequest(BackupConfig(setOf(1), INCLUDE_EXISTING), budgetMs, parallelUploads = parallelUploads) { timedOut }

    /** The library as it sees files 1 and 2 when they hold the same bytes. */
    internal fun twins(): BackupTransport = object : BackupTransport by transport {
        override suspend fun hash(media: BackupMedia): String? = if (media.id <= 2) "same" else "h${media.id}"
    }
}

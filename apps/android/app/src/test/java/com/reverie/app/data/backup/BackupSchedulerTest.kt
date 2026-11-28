package com.reverie.app.data.backup

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The run that waits out a "too many requests", over the real WorkManager. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class BackupSchedulerTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val settings = BackupSettings(enabled = true, bucketIds = setOf(1), addedAfter = INCLUDE_EXISTING)
    private lateinit var scheduler: BackupScheduler

    @Before fun setUp() {
        WorkManager.initialize(context, Configuration.Builder().build())
        scheduler = BackupScheduler(context)
    }

    private fun waiting(): List<WorkInfo> =
        WorkManager.getInstance(context).getWorkInfosForUniqueWork("reverie-backup-after-wait").get()
            .filter { it.state != WorkInfo.State.CANCELLED }

    @Test fun `one run waits at a time, for the latest delay, and one asked for by itself is appended`() {
        scheduler.scheduleAfterWait(settings, 600_000, BackupTrigger.Periodic)
        assertEquals(listOf(600_000L), waiting().map { it.initialDelayMillis })

        scheduler.scheduleAfterWait(settings, 500_000, BackupTrigger.NewMedia)
        assertEquals(listOf(500_000L), waiting().map { it.initialDelayMillis })
        assertEquals(listOf(WorkInfo.State.ENQUEUED), waiting().map { it.state })

        scheduler.scheduleAfterWait(settings, 400_000, BackupTrigger.AfterWait)
        assertEquals(
            setOf(500_000L to WorkInfo.State.ENQUEUED, 400_000L to WorkInfo.State.BLOCKED),
            waiting().map { it.initialDelayMillis to it.state }.toSet(),
        )

        scheduler.apply(settings.copy(enabled = false))
        assertEquals(emptyList<WorkInfo>(), waiting())
    }
}

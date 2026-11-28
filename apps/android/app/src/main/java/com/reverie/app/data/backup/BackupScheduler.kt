package com.reverie.app.data.backup

import android.content.Context
import android.provider.MediaStore
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Which of the scheduled works started a run; "Back up now" is the only one the user asked for. */
enum class BackupTrigger { Periodic, NewMedia, Continuation, AfterWait, Manual }

private const val PERIODIC_WORK = "reverie-backup-periodic"
private const val TRIGGER_WORK = "reverie-backup-new-media"
private const val CONTINUE_WORK = "reverie-backup-continue"
private const val MANUAL_WORK = "reverie-backup-now"
private const val WAIT_WORK = "reverie-backup-after-wait"
private val ALL_WORKS = listOf(PERIODIC_WORK, TRIGGER_WORK, CONTINUE_WORK, WAIT_WORK, MANUAL_WORK)
internal const val TRIGGER_KEY = "trigger"
private const val PERIOD_HOURS = 6L

/**
 * Owns every backup work request. All of them are plain (non-foreground) workers with the same
 * constraints: an unmetered network when "Wi-Fi only" is on, otherwise any network, and never on
 * low battery.
 */
@Singleton
class BackupScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val workManager get() = WorkManager.getInstance(context)

    /** Makes the scheduled works match [settings]: all armed when backup is ready, all cancelled otherwise. */
    fun apply(settings: BackupSettings) {
        if (!settings.isReady) {
            cancelAll()
            return
        }
        val constraints = constraintsFor(settings.wifiOnly)
        // UPDATE (not keep) so a changed Wi-Fi setting takes effect on a periodic work that is already queued.
        workManager.enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<BackupWorker>(PERIOD_HOURS, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setInputData(inputFor(BackupTrigger.Periodic))
                .build(),
        )
        workManager.enqueueUniqueWork(TRIGGER_WORK, ExistingWorkPolicy.REPLACE, newMediaRequest(constraints))
        // Turning backup on (or changing its settings) should start working now, not in six hours.
        enqueueOnce(CONTINUE_WORK, BackupTrigger.Continuation, constraints, ExistingWorkPolicy.KEEP)
    }

    /**
     * Re-arms the new-media trigger. Called at the end of a run started by that very trigger: the work
     * is appended so it only becomes active once the current run has finished.
     */
    fun rearmNewMediaTrigger(settings: BackupSettings) {
        if (!settings.isReady) return
        workManager.enqueueUniqueWork(
            TRIGGER_WORK,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            newMediaRequest(constraintsFor(settings.wifiOnly)),
        )
    }

    /** More work is waiting (a run ran out of time, or albums changed): start a run as soon as the constraints allow. */
    fun scheduleContinuation(settings: BackupSettings) {
        if (!settings.isReady) return
        // Appended, so a continuation requested by a run that is itself one starts after it ends.
        enqueueOnce(CONTINUE_WORK, BackupTrigger.Continuation, constraintsFor(settings.wifiOnly), ExistingWorkPolicy.APPEND_OR_REPLACE)
    }

    /**
     * The server told the run started by [from] to stay away: start one once [delayMs] has passed. Only one
     * such run waits at a time, with the latest delay; replacing it from within itself would cancel the run
     * that is asking, so then the next one is appended.
     */
    fun scheduleAfterWait(settings: BackupSettings, delayMs: Long, from: BackupTrigger) {
        if (!settings.isReady) return
        val policy = if (from == BackupTrigger.AfterWait) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.REPLACE
        enqueueOnce(WAIT_WORK, BackupTrigger.AfterWait, constraintsFor(settings.wifiOnly), policy, delayMs)
    }

    /** "Back up now": same network rule as the others (Wi-Fi only still means unmetered), but a low battery doesn't hold it back. */
    fun backUpNow(settings: BackupSettings) {
        if (!settings.isReady) return
        enqueueOnce(MANUAL_WORK, BackupTrigger.Manual, constraintsFor(settings.wifiOnly, requireBattery = false), ExistingWorkPolicy.REPLACE)
    }

    /** True while any backup run is going. */
    fun observeRunning(): Flow<Boolean> = workManager
        .getWorkInfosFlow(androidx.work.WorkQuery.fromUniqueWorkNames(ALL_WORKS))
        .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }

    private fun cancelAll() {
        ALL_WORKS.forEach(workManager::cancelUniqueWork)
    }

    private fun newMediaRequest(constraints: Constraints) = OneTimeWorkRequestBuilder<BackupWorker>()
        .setConstraints(
            Constraints.Builder()
                .setRequiredNetworkType(constraints.requiredNetworkType)
                .setRequiresBatteryNotLow(true)
                .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
                .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
                // Wait for a burst of new files (a camera roll sync, a burst shot) to settle before running.
                .setTriggerContentUpdateDelay(30, TimeUnit.SECONDS)
                .setTriggerContentMaxDelay(5, TimeUnit.MINUTES)
                .build(),
        )
        .setInputData(inputFor(BackupTrigger.NewMedia))
        .build()

    private fun enqueueOnce(
        name: String,
        trigger: BackupTrigger,
        constraints: Constraints,
        policy: ExistingWorkPolicy,
        delayMs: Long = 0,
    ) {
        val request = OneTimeWorkRequestBuilder<BackupWorker>()
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .setConstraints(constraints)
            .setInputData(inputFor(trigger))
            // The worker never asks for a retry; this only bounds WorkManager's own rescheduling after a process death.
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(name, policy, request)
    }

    private fun inputFor(trigger: BackupTrigger): Data = workDataOf(TRIGGER_KEY to trigger.name)

    private fun constraintsFor(wifiOnly: Boolean, requireBattery: Boolean = true): Constraints = Constraints.Builder()
        .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(requireBattery)
        .build()
}

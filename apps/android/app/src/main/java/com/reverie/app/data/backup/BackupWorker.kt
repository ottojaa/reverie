package com.reverie.app.data.backup

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkInfo
import androidx.work.WorkerParameters
import com.reverie.app.R
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.domain.model.AuthState
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** How long a background run keeps starting new work. WorkManager stops any run after about 10 minutes. */
internal const val BACKGROUND_BUDGET_MS = 8 * 60_000L

/** A foreground run has no such limit; this is simply "until the library is done". */
private const val UNLIMITED_BUDGET_MS = Long.MAX_VALUE / 4

/**
 * Backs up new photos and videos in the background. A plain worker, not a foreground service: on
 * Android 12+ a worker started in the background that asks for foreground status throws, and
 * Android 15 caps data-sync foreground services at 6 hours a day. It still *tries* to become a
 * foreground run, so that when the user starts it from the open app the 10-minute limit is lifted;
 * if that is refused it carries on as an ordinary background run.
 *
 * It always reports success: what failed is kept in the ledger's retry table and the settings, so
 * WorkManager never applies its own (tight) retry schedule.
 */
@HiltWorker
class BackupWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val runner: BackupRunner,
    private val settingsRepository: BackupSettingsRepository,
    private val scheduler: BackupScheduler,
    private val dao: BackupDao,
    private val auth: AuthSessionManager,
    private val serverUrl: ServerUrlProvider,
) : CoroutineWorker(appContext, params) {

    private val startedAt = System.currentTimeMillis()

    override suspend fun doWork(): Result {
        val trigger = inputData.getString(TRIGGER_KEY)?.let { runCatching { BackupTrigger.valueOf(it) }.getOrNull() }
            ?: BackupTrigger.Periodic
        try {
            runPass(trigger)
        } finally {
            // Re-arm even when the run was cancelled, or the next new photo would never start a run.
            // NonCancellable: reading the settings would throw at once in a coroutine that is already cancelled.
            if (trigger == BackupTrigger.NewMedia) {
                withContext(NonCancellable) { scheduler.rearmNewMediaTrigger(settingsRepository.current()) }
            }
        }
        return Result.success()
    }

    private suspend fun runPass(trigger: BackupTrigger) {
        val settings = settingsRepository.current()
        val config = settings.toConfig() ?: return
        // A queued run can outlive a change of the Wi-Fi setting, so the rule is checked again here.
        if (settings.wifiOnly && isNetworkMetered()) return
        preflightError(settings)?.let { return settingsRepository.recordError(it) }

        val userInitiated = trigger == BackupTrigger.Manual
        val foreground = tryForeground()
        val request = BackupRequest(
            config = config,
            budgetMs = if (userInitiated && foreground) UNLIMITED_BUDGET_MS else BACKGROUND_BUDGET_MS,
            userInitiated = userInitiated,
            includeParked = userInitiated && foreground,
            wasStoppedByTimeout = ::wasStoppedByTimeout,
            seesAllMedia = applicationContext.mediaAccess() == MediaAccess.Full,
        )
        val result = try {
            runner.run(request)
        } catch (e: CancellationException) {
            throw e
        } catch (e: SecurityException) {
            // The user revoked access while the pass was running.
            return settingsRepository.recordError("Photo access was turned off. Allow it in Settings to resume backup.")
        } catch (e: Exception) {
            // Whatever else goes wrong, say so on the status line instead of leaving it stale.
            return settingsRepository.recordError("Backup stopped unexpectedly and will try again later.")
        }
        report(result, settings)
    }

    private fun isNetworkMetered(): Boolean =
        applicationContext.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: true

    /** A reason the pass can't even start, in plain words; also makes sure the ledger belongs to the current account. */
    private suspend fun preflightError(settings: BackupSettings): String? {
        if (applicationContext.mediaAccess() == MediaAccess.None) {
            return "Allow photo and video access to back up."
        }
        if (!applicationContext.canReadLocation()) {
            return "Allow access to photo locations, so backed-up photos keep where they were taken."
        }
        // The app may not be open, so nothing has loaded the saved sign-in yet.
        if (auth.authState.value is AuthState.Unknown) auth.bootstrap()
        val user = (auth.authState.value as? AuthState.Authenticated)?.user
            ?: return "You're signed out. Sign in again to resume backup."
        claimLibrary(settings, "${serverUrl.current()}|${user.id}")
        return null
    }

    /**
     * The ledger says "this phone photo is in *that* library". After switching server or account it
     * would wrongly say "done", so it starts over; the server's content check still skips whatever
     * the new library already holds.
     */
    private suspend fun claimLibrary(settings: BackupSettings, key: String) {
        if (settings.libraryKey == key) return
        if (settings.libraryKey != null) dao.clearAll()
        settingsRepository.setLibraryKey(key)
    }

    private suspend fun report(result: PassResult, settings: BackupSettings) {
        when (val end = result.end) {
            PassEnd.Busy -> return
            is PassEnd.Stopped -> settingsRepository.recordError(end.error)
            PassEnd.OutOfTime -> {
                recordOutcome(result)
                scheduler.scheduleContinuation(settings)
            }
            PassEnd.Completed -> recordOutcome(result)
        }
    }

    /** A pass that got through its queue is a success even if single files failed; those retry later and are shown. */
    private suspend fun recordOutcome(result: PassResult) {
        settingsRepository.recordSuccess(System.currentTimeMillis())
        result.firstFailure?.let { settingsRepository.recordError("${result.failed} file(s) failed: $it") }
    }

    private fun wasStoppedByTimeout(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return stopReason == WorkInfo.STOP_REASON_TIMEOUT
        // Before Android 12 the stop reason isn't reported; a stop after a full slice is a timeout.
        return System.currentTimeMillis() - startedAt >= BACKGROUND_BUDGET_MS
    }

    /** True when Android accepted foreground status; refused from the background on Android 12+, which is fine. */
    private suspend fun tryForeground(): Boolean = try {
        setForeground(foregroundInfo())
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    private fun foregroundInfo(): ForegroundInfo {
        ensureChannel()
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setContentTitle("Backing up to Reverie")
            .setContentText("Photos and videos are being backed up")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Backup", NotificationManager.IMPORTANCE_LOW))
    }

    private companion object {
        const val CHANNEL_ID = "reverie_backup"
        const val NOTIFICATION_ID = 43
    }
}

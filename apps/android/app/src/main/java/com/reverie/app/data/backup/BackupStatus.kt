package com.reverie.app.data.backup

import android.content.Context
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.di.IoDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

/** Where photo backup stands, in as few cases as a person needs to tell apart. */
sealed interface BackupStatus {
    /** Not worked out yet, or the phone's photos could not be read just now. */
    data object Unknown : BackupStatus

    data object Off : BackupStatus

    /** Switched on, with no destination folder or no album chosen. */
    data object NotSetUp : BackupStatus

    data object Running : BackupStatus

    /** The last run failed, or the app may not see all of the photos. */
    data object NeedsAttention : BackupStatus

    data class Waiting(val count: Int) : BackupStatus

    data object Complete : BackupStatus
}

/**
 * The status as it changes. The phone's photos are only read when nothing else decides the answer, and
 * are read again whenever [checks] emits (a photo taken since the last look is a file waiting).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun backupStatus(
    settings: Flow<BackupSettings>,
    isRunning: Flow<Boolean>,
    ledgerIds: Flow<List<Long>>,
    checks: Flow<Int>,
    access: () -> MediaAccess,
    loadMedia: suspend () -> List<BackupMedia>,
): Flow<BackupStatus> = combine(settings, isRunning, ledgerIds, checks) { current, running, uploaded, _ ->
    Triple(current, running, uploaded)
}.mapLatest { (current, running, uploaded) ->
    when {
        !current.enabled -> BackupStatus.Off
        !current.isReady -> BackupStatus.NotSetUp
        running -> BackupStatus.Running
        current.lastError != null || access() != MediaAccess.Full -> BackupStatus.NeedsAttention
        else -> pendingStatus(current.bucketIds.orEmpty(), uploaded.toSet(), loadMedia)
    }
}.distinctUntilChanged()

private suspend fun pendingStatus(
    bucketIds: Set<Long>,
    uploaded: Set<Long>,
    loadMedia: suspend () -> List<BackupMedia>,
): BackupStatus = try {
    val waiting = scanPending(loadMedia(), bucketIds, uploaded).size
    if (waiting == 0) BackupStatus.Complete else BackupStatus.Waiting(waiting)
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (_: Exception) {
    // Saying "complete" without having looked would be a guess.
    BackupStatus.Unknown
}

/** [backupStatus] over this phone's backup settings, work queue, upload ledger and photos. */
@Singleton
class BackupStatusSource @Inject constructor(
    private val settings: BackupSettingsRepository,
    private val scheduler: BackupScheduler,
    private val dao: BackupDao,
    private val media: BackupMediaSource,
    @ApplicationContext private val context: Context,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    private val checks = MutableStateFlow(0)

    fun observe(): Flow<BackupStatus> = backupStatus(
        settings = settings.settings,
        isRunning = scheduler.observeRunning(),
        ledgerIds = dao.observeLedgerIds(),
        checks = checks,
        access = { context.mediaAccess() },
        loadMedia = media::queryMedia,
    ).flowOn(io)

    /** Look at the phone's photos again: call when a screen showing the status comes back to the front. */
    fun recheck() = checks.update { it + 1 }
}

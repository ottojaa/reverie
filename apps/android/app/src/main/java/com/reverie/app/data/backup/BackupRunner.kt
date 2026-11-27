package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.data.local.entity.BackupLedgerEntity
import com.reverie.app.data.local.entity.BackupRetryEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext

/** How many files are hashed and checked against the library together. */
const val BACKUP_GROUP_SIZE = 25

/** How long a user-started pass waits for a background pass to finish before giving up. */
private const val LOCK_WAIT_MS = 5 * 60_000L

/** Ends a pass early with a plain-words reason; never leaves the runner. */
private class StopPass(val reason: String) : Exception(reason)

/**
 * Runs backup passes: finds device files the ledger hasn't handled, skips what the library already
 * holds, uploads the rest into their album's folder a few at a time, and writes the ledger after every
 * file so a pass can be cut off at any moment and the next one resumes where it stopped. An album whose
 * folder takes no uploads is left out of the rest of the pass; its files wait, and don't count as failures.
 *
 * Only one pass runs at a time in the process: the periodic job, the new-media trigger and "Back up
 * now" are separate works that can start together, and two passes would upload the same file twice.
 */
@Singleton
class BackupRunner internal constructor(
    private val source: BackupMediaSource,
    private val transport: BackupTransport,
    private val dao: BackupDao,
    private val folders: BackupFolders,
    private val settings: BackupSettingsRepository,
    private val manualUploads: ManualUploads = ManualUploads { false },
    private val budget: UploadBudget = UploadBudget(),
    /** Must run one thing at a time: a pass keeps its sets and counts without locks while uploads overlap. */
    private val passContext: CoroutineContext = EmptyCoroutineContext,
    private val now: () -> Long,
) {
    @Inject
    constructor(
        source: BackupMediaSource,
        transport: BackupTransport,
        dao: BackupDao,
        folders: BackupFolders,
        settings: BackupSettingsRepository,
        manualUploads: ManualUploads,
    ) : this(
        source, transport, dao, folders, settings, manualUploads,
        passContext = Dispatchers.Default.limitedParallelism(1),
        now = System::currentTimeMillis,
    )

    private val lock = Mutex()

    suspend fun run(request: BackupRequest): PassResult {
        if (!acquire(request)) return PassResult(PassEnd.Busy)
        try {
            return withContext(passContext) { Pass(request).run() }
        } finally {
            lock.unlock()
        }
    }

    /** A background pass gives up at once when another runs; a pass the user asked for waits its turn. */
    private suspend fun acquire(request: BackupRequest): Boolean {
        if (!request.userInitiated) return lock.tryLock()
        return withTimeoutOrNull(LOCK_WAIT_MS) { lock.lock(); true } ?: false
    }

    private inner class Pass(val request: BackupRequest) {
        private val deadline = now() + request.budgetMs
        private val failedThisPass = mutableSetOf<Long>()
        private val blockedAlbums = mutableSetOf<Long>()
        private val uploadedHashes = mutableMapOf<String, String?>()
        private var retries = emptyMap<Long, BackupRetryEntity>()
        private var uploaded = 0
        private var skipped = 0
        private var failed = 0
        private var firstFailure: String? = null
        private var uploadsStarted = 0
        private var ranOutOfTime = false
        private val uploads = SideBySideUploads(request.parallelUploads, manualUploads)

        suspend fun run(): PassResult {
            val end = try {
                workUntilDone()
            } catch (stop: StopPass) {
                PassEnd.Stopped(stop.reason)
            }
            return PassResult(end, uploaded, skipped, failed, firstFailure)
        }

        private fun isTimeUp() = now() >= deadline

        /** Works through the queue, rescanning whenever it drains so files added mid-pass are picked up. */
        private suspend fun workUntilDone(): PassEnd {
            while (true) {
                val queue = loadQueue()
                if (queue.isEmpty()) return PassEnd.Completed
                if (!drain(queue)) return PassEnd.OutOfTime
            }
        }

        private suspend fun loadQueue(): ArrayDeque<BackupMedia> {
            val ledger = dao.ledgerIds().toSet()
            retries = dao.retries().associateBy { it.mediaId }
            val media = source.queryMedia()
            val albums = toAlbums(media)
            noteAlbums(albums)
            checkAlbumFolders(albums.filter { it.bucketId in request.config.bucketIds })
            val pending = scanPending(media, request.config.bucketIds, ledger, request.config.addedAfter)
            val ordered = orderForRun(pending, retries, now(), request.userInitiated, request.includeParked)
            return ArrayDeque(ordered.filter { it.id !in failedThisPass && !isBlocked(it) })
        }

        /** Tells the settings which albums the phone has, when this pass can see all of them. */
        private suspend fun noteAlbums(albums: List<BackupAlbum>) {
            if (!request.seesAllMedia) return
            val ids = albums.map { it.bucketId }.toSet()
            settings.seedKnownAlbums(ids)
            // An album that left the phone, say by being renamed, has no row left to show its problem on.
            settings.keepAlbumProblems(ids)
        }

        /** Makes the folders [albums] still lack, even with nothing to upload, and finds the ones that take no uploads. */
        private suspend fun checkAlbumFolders(albums: List<BackupAlbum>) {
            for (album in albums.filter { it.bucketId !in blockedAlbums }) {
                try {
                    folders.check(album.bucketId, album.name)
                } catch (e: AlbumBlocked) {
                    blockedAlbums += album.bucketId
                } catch (e: ReverieApiException) {
                    // A refusal of this one folder is recorded against its files when they are uploaded.
                    if (!isOneFilesFault(e)) throw StopPass(stopReason(e))
                }
            }
        }

        private fun isBlocked(media: BackupMedia) = media.bucketId in blockedAlbums

        /** Processes [queue]; false when the time ran out first. */
        private suspend fun drain(queue: ArrayDeque<BackupMedia>): Boolean {
            while (queue.isNotEmpty()) {
                if (isTimeUp()) return false
                if (!processGroup(takeGroup(queue))) return false
            }
            return true
        }

        /** A file that was cut off before goes alone (it needs the whole run); the others go in groups. */
        private fun takeGroup(queue: ArrayDeque<BackupMedia>): List<BackupMedia> {
            if (cutOffsOf(queue.first()) > 0) return listOf(queue.removeFirst())
            val group = mutableListOf<BackupMedia>()
            while (queue.isNotEmpty() && group.size < BACKUP_GROUP_SIZE && cutOffsOf(queue.first()) == 0) {
                group += queue.removeFirst()
            }
            return group
        }

        private fun cutOffsOf(media: BackupMedia) = retries[media.id]?.cutOffs ?: 0

        /** Hashes, checks and uploads one group; false when the time ran out part-way. */
        private suspend fun processGroup(group: List<BackupMedia>): Boolean {
            val hashed = mutableListOf<Pair<BackupMedia, String>>()
            var inTime = true
            for (media in group.filterNot(::isBlocked)) {
                if (isTimeUp()) { inTime = false; break }
                val hash = transport.hash(media)
                if (hash == null) recordFailure(media, "Couldn't read the file.") else hashed += media to hash
            }
            if (hashed.isEmpty()) return inTime

            val results = checkContent(hashed)
            val toUpload = hashed.filterIndexed { index, (media, hash) ->
                val known = results[index].content != null
                if (known) ledger(media, hash, documentId = null, BackupLedgerEntity.OUTCOME_SKIPPED)
                !known
            }
            // Identical files share one turn, so the same bytes never go up twice side by side.
            val turns = toUpload.groupBy { (_, hash) -> hash }.values.toList()
            uploads.run(turns, awaitRoom = ::awaitBudget, upload = ::uploadInTurn)
            return inTime && !ranOutOfTime
        }

        private suspend fun uploadInTurn(files: List<Pair<BackupMedia, String>>) {
            for ((media, hash) in files) {
                if (isBlocked(media)) continue
                if (!mayStart()) return
                upload(media, hash)
            }
        }

        /** Whether another file may start: no upload has ended the pass, and there is time left. */
        private fun mayStart(): Boolean {
            if (uploads.isHalted) return false
            if (!isTimeUp()) return true
            ranOutOfTime = true
            return false
        }

        /** Waits for room in the server's request budget, no longer than the pass has; false if no file may start. */
        private suspend fun awaitBudget(): Boolean {
            while (mayStart()) {
                val wait = budget.take(now())
                if (wait == 0L) return true
                uploads.pause(minOf(wait, deadline - now()))
            }
            return false
        }

        private suspend fun checkContent(hashed: List<Pair<BackupMedia, String>>): List<CheckContentResult> {
            val results = try {
                transport.checkContent(hashed.map { (media, hash) -> CheckContentFile(media.displayName, hash) })
            } catch (e: ReverieApiException) {
                throw StopPass(stopReason(e))
            }
            // Never upload on a partial answer: an unmatched file would be treated as new.
            if (results.size != hashed.size) throw StopPass("The server sent an unexpected response.")
            return results
        }

        private suspend fun upload(media: BackupMedia, hash: String) {
            // Identical bytes twice in one pass: the first upload already put them in the library.
            if (uploadedHashes.containsKey(hash)) {
                ledger(media, hash, documentId = null, BackupLedgerEntity.OUTCOME_SKIPPED)
                return
            }
            val isFirstUpload = uploadsStarted++ == 0
            try {
                val documentId = folders.useFolder(media.bucketId, media.bucketName) { transport.upload(media, it) }
                uploadedHashes[hash] = documentId
                ledger(media, hash, documentId, BackupLedgerEntity.OUTCOME_UPLOADED)
            } catch (e: CancellationException) {
                withContext(NonCancellable) { recordCutOff(media, isFirstUpload) }
                throw e
            } catch (e: AlbumBlocked) {
                blockedAlbums += media.bucketId
            } catch (e: ReverieApiException) {
                handleUploadFailure(media, e)
            } catch (e: java.io.IOException) {
                recordFailure(media, "Couldn't read the file.")
            }
        }

        private suspend fun handleUploadFailure(media: BackupMedia, e: ReverieApiException) {
            if (!isOneFilesFault(e)) throw StopPass(stopReason(e))
            recordFailure(media, e.userMessage())
        }

        private suspend fun ledger(media: BackupMedia, hash: String, documentId: String?, outcome: String) {
            dao.markHandled(BackupLedgerEntity(media.id, hash, documentId, outcome, now()))
            if (outcome == BackupLedgerEntity.OUTCOME_SKIPPED) skipped++ else uploaded++
        }

        private suspend fun recordFailure(media: BackupMedia, message: String) {
            val before = retries[media.id]
            val failures = (before?.failures ?: 0) + 1
            val row = BackupRetryEntity(media.id, failures, before?.cutOffs ?: 0, nextAttemptAfter(failures, now()), message)
            dao.putRetry(row)
            retries = retries + (media.id to row)
            failedThisPass += media.id
            failed++
            if (firstFailure == null) firstFailure = message
        }

        /**
         * A timeout stop only counts against the file. The first time it goes to the head of the next
         * run; if it was cut off again while uploading first in a run, it doesn't fit in one run and is
         * parked. Losing the network or battery says nothing about the file's size and leaves it alone.
         */
        private suspend fun recordCutOff(media: BackupMedia, wasFirstUpload: Boolean) {
            if (!request.wasStoppedByTimeout()) return
            val before = retries[media.id]
            val cutOffs = if (wasFirstUpload && (before?.cutOffs ?: 0) >= CUT_OFF_PRIORITY) CUT_OFF_PARKED else CUT_OFF_PRIORITY
            val row = BackupRetryEntity(media.id, before?.failures ?: 0, cutOffs, before?.nextAttemptAt ?: 0, before?.lastError)
            dao.putRetry(row)
        }
    }
}

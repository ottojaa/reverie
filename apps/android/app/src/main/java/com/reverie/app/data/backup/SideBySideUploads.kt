package com.reverie.app.data.backup

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The most files backup uploads at once. The app's HTTP client makes up to 5 calls to the server at a
 * time, so this leaves some for the user's own uploads and browsing.
 */
const val MAX_PARALLEL_UPLOADS = 3

/**
 * Runs uploads a few at a time, starting them in order. While the user's own upload is running, the
 * next one waits for those in flight, so backup goes one at a time. Once an upload throws, no further
 * one is started: those in flight finish, then the first exception is thrown to the caller.
 * Cancelling the caller cancels them all.
 */
internal class SideBySideUploads(parallel: Int, private val manualUploads: ManualUploads) {
    private val slots = Semaphore(parallel.coerceIn(1, MAX_PARALLEL_UPLOADS))
    private val failure = CompletableDeferred<Exception>()

    /** An upload has thrown, so nothing more may start. */
    val isHalted: Boolean get() = failure.isCompleted

    /** Waits [ms], or less if an upload throws meanwhile. */
    suspend fun pause(ms: Long) {
        withTimeoutOrNull(ms) { failure.await() }
    }

    /**
     * Calls [upload] for each of [items]. [awaitRoom] is asked before each one, and may wait; when it
     * says no, that item and the rest are left out. [upload] must itself do nothing once [isHalted].
     */
    suspend fun <T> run(items: List<T>, awaitRoom: suspend () -> Boolean, upload: suspend (T) -> Unit) {
        coroutineScope {
            val started = mutableListOf<Job>()
            for (item in items) {
                slots.acquire()
                if (!awaitRoom()) {
                    slots.release()
                    break
                }
                // Asked last, after every other wait, so the answer still holds when the upload starts.
                if (manualUploads.isRunning()) started.joinAll()
                started += launch { runOne { upload(item) } }
            }
        }
        if (isHalted) throw failure.await()
    }

    /** The exception is kept, not let through: that would cancel the other uploads half-way. */
    private suspend fun runOne(upload: suspend () -> Unit) {
        try {
            upload()
        } catch (e: CancellationException) {
            failure.complete(e)
            throw e
        } catch (e: Exception) {
            failure.complete(e)
        } finally {
            slots.release()
        }
    }
}

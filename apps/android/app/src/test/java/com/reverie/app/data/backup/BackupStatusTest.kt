package com.reverie.app.data.backup

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class BackupStatusTest {

    private val ready = BackupSettings(enabled = true, bucketIds = setOf(1L), folderId = "camera", folderName = "Camera")

    private fun photo(id: Long, bucket: Long = 1L) = BackupMedia(id, "$id.jpg", "image/jpeg", 1, bucket)

    /** What the phone says, changeable while the status is being watched. */
    private inner class Phone {
        val settings = MutableStateFlow(ready)
        val isRunning = MutableStateFlow(false)
        val uploaded = MutableStateFlow(listOf(1L))
        val checks = MutableStateFlow(0)
        var access = MediaAccess.Full
        var photos = listOf(photo(1))
        var reads = 0
        var isUnreadable = false
        val seen = mutableListOf<BackupStatus>()
        val status: BackupStatus get() = seen.last()
    }

    private fun TestScope.watch(arrange: Phone.() -> Unit = {}): Phone {
        val phone = Phone().apply(arrange)
        backupStatus(
            settings = phone.settings,
            isRunning = phone.isRunning,
            ledgerIds = phone.uploaded,
            checks = phone.checks,
            access = { phone.access },
            loadMedia = {
                phone.reads++
                if (phone.isUnreadable) error("no media store")
                phone.photos
            },
        ).onEach { phone.seen += it }.launchIn(backgroundScope as CoroutineScope)
        return phone
    }

    @Test fun `everything chosen being uploaded is complete`() = runTest(UnconfinedTestDispatcher()) {
        val phone = watch { photos = listOf(photo(1), photo(2, bucket = 9L)) }

        assertEquals(BackupStatus.Complete, phone.status)
    }

    @Test fun `a new photo is waiting once the phone is looked at again`() = runTest(UnconfinedTestDispatcher()) {
        val phone = watch()
        phone.photos = listOf(photo(2), photo(1))

        phone.checks.value = 1

        assertEquals(BackupStatus.Waiting(1), phone.status)
    }

    @Test fun `a run shows as running and its uploads as done`() = runTest(UnconfinedTestDispatcher()) {
        val phone = watch { photos = listOf(photo(2), photo(1)) }

        phone.isRunning.value = true
        assertEquals(BackupStatus.Running, phone.status)

        phone.uploaded.value = listOf(1L, 2L)
        phone.isRunning.value = false
        assertEquals(BackupStatus.Complete, phone.status)
    }

    @Test fun `off and not set up are said without reading the photos`() = runTest(UnconfinedTestDispatcher()) {
        val phone = watch { settings.value = ready.copy(enabled = false) }
        assertEquals(BackupStatus.Off, phone.status)

        listOf(ready.copy(folderId = null), ready.copy(bucketIds = null), ready.copy(bucketIds = emptySet())).forEach {
            phone.settings.value = it
            assertEquals(BackupStatus.NotSetUp, phone.status)
        }
        assertEquals(0, phone.reads)
    }

    @Test fun `a failed run or partial access needs attention`() = runTest(UnconfinedTestDispatcher()) {
        val phone = watch { settings.value = ready.copy(lastError = "refused") }
        assertEquals(BackupStatus.NeedsAttention, phone.status)

        phone.access = MediaAccess.Limited
        phone.settings.value = ready

        assertEquals(BackupStatus.NeedsAttention, phone.status)
    }

    @Test fun `photos that cannot be read are not called backed up`() = runTest(UnconfinedTestDispatcher()) {
        val phone = watch { isUnreadable = true }

        assertEquals(BackupStatus.Unknown, phone.status)
    }
}

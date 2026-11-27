package com.reverie.app.ui.screens.account

import com.reverie.app.data.backup.BackupSettings
import org.junit.Assert.assertEquals
import org.junit.Test

class BackupDetailTest {
    private val ready = BackupSettings(enabled = true, bucketIds = setOf(1L), addedAfter = 0)

    @Test fun `one album is named, with the network backup waits for`() {
        assertEquals("Camera · Wi-Fi only", backupDetail(ready, album = "Camera"))
        assertEquals("Camera · Any network", backupDetail(ready.copy(wifiOnly = false), album = "Camera"))
    }

    @Test fun `albums that aren't named are counted`() {
        assertEquals("3 albums · Wi-Fi only", backupDetail(ready.copy(bucketIds = setOf(1L, 2L, 3L)), album = null))
        assertEquals("1 album · Wi-Fi only", backupDetail(ready, album = null))
    }

    @Test fun `backup that is off or unfinished says so`() {
        assertEquals("Photos aren’t backed up automatically", backupDetail(BackupSettings(), album = null))
        assertEquals("Finish setting up backup", backupDetail(ready.copy(addedAfter = null), album = null))
    }
}

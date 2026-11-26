package com.reverie.app.ui.screens.trash

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class TrashItemTest {
    private val now = Instant.parse("2026-11-01T12:00:00Z")

    private fun file(purgeAt: String) = TrashItem.Document(trashedFile("a", purgeAt = purgeAt))

    private fun folder(folders: Int = 0, files: Int = 0, locked: Boolean = false) =
        TrashItem.Folder(trashedFolder("Diary", folders, files, locked = locked, purgeAt = "2026-11-28T12:00:00.000Z"))

    @Test fun `time left counts whole days, rounding a part of one up`() {
        assertEquals("27 days left", toTimeLeft("2026-11-28T12:00:00.000Z", now))
        assertEquals("2 days left", toTimeLeft("2026-11-02T12:00:01Z", now))
        assertEquals("1 day left", toTimeLeft("2026-11-01T13:00:00Z", now))
        assertEquals("Removed soon", toTimeLeft("2026-11-01T11:00:00Z", now))
        assertEquals("", toTimeLeft("soon", now))
    }

    @Test fun `a file shows its size and a folder what is in it`() {
        assertEquals("2.3 MB · 1 day left", trashMeta(file("2026-11-02T12:00:00Z"), now))
        assertEquals("2 folders · 14 files · 27 days left", trashMeta(folder(2, 14), now))
        assertEquals("1 file · 27 days left", trashMeta(folder(files = 1), now))
        assertEquals("Empty · 27 days left", trashMeta(folder(), now))
        assertEquals("Locked · 27 days left", trashMeta(folder(locked = true), now))
    }

    @Test fun `deleting a folder for good says what goes with it`() {
        assertEquals(
            "The 2 folders and 14 files in it are deleted with it. This can't be undone.",
            purgeMessage(listOf(folder(2, 14))),
        )
        assertEquals("The 1 file in it is deleted with it. This can't be undone.", purgeMessage(listOf(folder(files = 1))))
        assertEquals("This can't be undone.", purgeMessage(listOf(folder())))
        assertEquals("This can't be undone.", purgeMessage(listOf(file("2026-11-02T12:00:00Z"))))
    }

    @Test fun `deleting several for good counts them and says folders take their contents`() {
        val files = listOf(file(""), file(""))

        assertEquals("Delete 2 items forever?", purgeTitle(files))
        assertEquals("Delete “Diary” forever?", purgeTitle(listOf(folder())))
        assertEquals("This can't be undone.", purgeMessage(files))
        assertEquals("Everything in the folder is deleted with it. This can't be undone.", purgeMessage(files + folder()))
        assertEquals(
            "Everything in the folders is deleted with them. This can't be undone.",
            purgeMessage(listOf(folder(), folder())),
        )
    }

    @Test fun `items are sent as the kinds of things they are`() {
        val selection = listOf(folder(), file("")).toSelection()

        assertEquals(listOf("Diary") to listOf("a"), selection.folder_ids to selection.document_ids)
    }
}

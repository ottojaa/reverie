package com.reverie.app.ui.screens.collections

import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.TopTypeDto
import org.junit.Assert.assertEquals
import org.junit.Test

class FolderSubtitleTest {
    private fun cover(images: Int = 0, videos: Int = 0, files: Int = 0, vararg types: Pair<String, Int>) = FolderCoverDto(
        summary = DocumentSummaryDto(
            image = KindTotalsDto(images),
            video = KindTotalsDto(videos),
            file = FileTotalsDto(files, top_types = types.map { TopTypeDto(it.first, it.second) }),
        ),
    )

    @Test fun `only photos count as photos`() {
        assertEquals("25 photos", folderSubtitle(cover(images = 25), documentCount = 25))
        assertEquals("1 photo", folderSubtitle(cover(images = 1), documentCount = 1))
    }

    @Test fun `only videos count as videos`() {
        assertEquals("3 videos", folderSubtitle(cover(videos = 3), documentCount = 3))
    }

    @Test fun `files list their commonest types with the dashboard's label rule`() {
        val code = cover(files = 13, types = arrayOf("ts" to 6, "json" to 4, "md" to 3))

        assertEquals("13 files · TS, JSON, MD", folderSubtitle(code, documentCount = 13))
        assertEquals("91 files · APK", folderSubtitle(cover(files = 91, types = arrayOf("apk" to 91)), documentCount = 91))
    }

    @Test fun `no more than three types are listed`() {
        val many = cover(files = 10, types = arrayOf("ts" to 4, "json" to 3, "md" to 2, "css" to 1))

        assertEquals("10 files · TS, JSON, MD", folderSubtitle(many, documentCount = 10))
    }

    @Test fun `a MIME subtype that is not an extension reads FILE once`() {
        val odd = cover(files = 5, types = arrayOf("vnd.android.package" to 3, "octet-stream" to 2))

        assertEquals("5 files · FILE", folderSubtitle(odd, documentCount = 5))
    }

    @Test fun `a mix of kinds counts everything as files`() {
        assertEquals("18 files · PDF", folderSubtitle(cover(images = 10, files = 8, types = arrayOf("pdf" to 8)), documentCount = 18))
        assertEquals("12 files", folderSubtitle(cover(images = 10, videos = 2), documentCount = 12))
    }

    @Test fun `an empty folder says Empty`() {
        assertEquals("Empty", folderSubtitle(cover(), documentCount = 0))
    }

    @Test fun `without a cover the cached document count stands in`() {
        assertEquals("Empty", folderSubtitle(null, documentCount = 0))
        assertEquals("7 files", folderSubtitle(null, documentCount = 7))
        assertEquals("1 file", folderSubtitle(null, documentCount = 1))
    }
}

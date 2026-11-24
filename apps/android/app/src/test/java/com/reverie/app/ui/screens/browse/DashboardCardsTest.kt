package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.TopTypeDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DashboardCardsTest {

    private fun summary(photos: Int = 38, videos: Int = 19, files: Int = 191) = DocumentSummaryDto(
        image = KindTotalsDto(photos, photos * 1000L),
        video = KindTotalsDto(videos, videos * 5000L),
        file = FileTotalsDto(files, files * 100L, listOf(TopTypeDto("apk", 90), TopTypeDto("zip", 20))),
    )

    private fun kinds(rows: List<List<KindCard>>) = rows.map { row -> row.map { it.kind } }

    @Test
    fun `photos sit alone on a wide row, videos and files share the next`() {
        val rows = dashboardCards(summary(), emptySet())
        assertEquals(listOf(listOf(DocumentKind.IMAGE), listOf(DocumentKind.VIDEO, DocumentKind.FILE)), kinds(rows))
    }

    @Test
    fun `a kind with no documents has no card and videos and files take the first row`() {
        assertEquals(
            listOf(listOf(DocumentKind.VIDEO, DocumentKind.FILE)),
            kinds(dashboardCards(summary(photos = 0), emptySet())),
        )
    }

    @Test
    fun `a lone card fills its row`() {
        assertEquals(
            listOf(listOf(DocumentKind.IMAGE), listOf(DocumentKind.FILE)),
            kinds(dashboardCards(summary(videos = 0), emptySet())),
        )
        assertEquals(emptyList<List<KindCard>>(), dashboardCards(summary(0, 0, 0), emptySet()))
    }

    @Test
    fun `the cards carry the summary's count, bytes and the file types`() {
        val files = dashboardCards(summary(), emptySet()).last().last()
        assertEquals(191, files.count)
        assertEquals(19_100L, files.bytes)
        assertEquals(listOf("apk", "zip"), files.topTypes.map { it.ext })
        assertEquals(emptyList<TopTypeDto>(), dashboardCards(summary(), emptySet()).first().first().topTypes)
    }

    @Test
    fun `without a summary the cards are the cached kinds and show no figures`() {
        val rows = dashboardCards(null, setOf(DocumentKind.IMAGE, DocumentKind.FILE))
        assertEquals(listOf(listOf(DocumentKind.IMAGE), listOf(DocumentKind.FILE)), kinds(rows))
        rows.flatten().forEach {
            assertNull(it.count)
            assertNull(it.bytes)
        }
    }

    @Test
    fun `without a summary and an empty cache there are no cards`() {
        assertEquals(emptyList<List<KindCard>>(), dashboardCards(null, emptySet()))
    }
}

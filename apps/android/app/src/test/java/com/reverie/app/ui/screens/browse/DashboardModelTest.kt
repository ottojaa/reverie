package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.repository.PageResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A server holding [library] that writes each page it serves into [cache], and counts what it was asked. */
private class DashboardServer(var library: List<DocumentDto>) {
    val cache = MutableStateFlow<List<DocumentDto>>(emptyList())
    val summary = MutableStateFlow<DocumentSummaryDto?>(null)
    val pages = mutableListOf<Triple<BrowseTab, Int, Int>>()
    var summaries = 0
    var offline = false

    val requests: Int get() = pages.size + summaries

    fun page(tab: BrowseTab, offset: Int, limit: Int): PageResult {
        pages += Triple(tab, offset, limit)
        if (offline) error("offline")
        val ordered = library.filter { tab.kind == null || it.kind == tab.kind }.sortedByDescending { sortKeyOf(it, tab) }
        val items = ordered.drop(offset).take(limit)
        cache.update { (it + items).distinctBy(DocumentDto::id) }
        return PageResult(total = ordered.size, loaded = offset + items.size, last = items.lastOrNull())
    }

    fun fetchSummary(): DocumentSummaryDto {
        summaries++
        if (offline) error("offline")
        val fresh = DocumentSummaryDto(
            image = KindTotalsDto(library.count { it.kind == DocumentKind.IMAGE }, 1),
            video = KindTotalsDto(library.count { it.kind == DocumentKind.VIDEO }, 1),
            file = FileTotalsDto(library.count { it.kind == DocumentKind.FILE }, 1),
        )
        summary.value = fresh
        return fresh
    }
}

class DashboardModelTest {

    private val library = (1..9).map { doc("p$it", created = "2026-11-%02dT10:00:00Z".format(10 + it)) } +
        (1..3).map { doc("v$it", "video/mp4", created = "2026-11-%02dT11:00:00Z".format(10 + it)) } +
        (1..3).map { doc("f$it", "application/pdf", created = "2026-11-%02dT12:00:00Z".format(10 + it)) }

    private class Fixture(val server: DashboardServer, val model: DashboardModel, val failures: MutableList<Throwable>)

    private fun TestScope.open(server: DashboardServer = DashboardServer(library), pageSize: Int = 30): Fixture {
        val failures = mutableListOf<Throwable>()
        val model = DashboardModel(
            scope = backgroundScope as CoroutineScope,
            cache = server.cache,
            summary = server.summary,
            fetchPage = { tab, offset -> server.page(tab, offset, if (tab == BrowseTab.ALL) pageSize else if (tab == BrowseTab.PHOTOS) PHOTO_PREVIEW_COUNT else 1) },
            fetchSummary = { server.fetchSummary() },
            onFirstPageFailed = { failures += it },
            computation = UnconfinedTestDispatcher(testScheduler),
            sharing = SharingStarted.Eagerly,
        )
        testScheduler.runCurrent()
        return Fixture(server, model, failures)
    }

    @Test fun `opening the dashboard makes exactly four requests`() = runTest {
        val f = open()

        assertEquals(4, f.server.requests)
        assertEquals(1, f.server.summaries)
        assertEquals(setOf(BrowseTab.ALL, BrowseTab.PHOTOS, BrowseTab.VIDEOS), f.server.pages.map { it.first }.toSet())
        assertTrue("first pages only: ${f.server.pages}", f.server.pages.all { it.second == 0 })
    }

    @Test fun `the cards get their previews, the figures and the newest rows`() = runTest {
        val f = open()

        val state = f.model.state.value
        assertEquals(listOf("p9", "p8", "p7", "p6"), state.photoPreview.map { it.id })
        assertEquals("v3", state.videoPreview?.id)
        assertEquals(9, state.summary?.image?.count)
        assertEquals(15, state.total)
    }

    @Test fun `a refresh and a content change each read all four again`() = runTest {
        val f = open()

        f.model.refresh()
        testScheduler.runCurrent()
        assertEquals(8, f.server.requests)

        f.server.library = f.server.library.filterNot { it.id == "p9" }
        f.model.contentChanged()
        testScheduler.runCurrent()
        assertEquals(12, f.server.requests)
        assertEquals(8, f.model.state.value.summary?.image?.count)
    }

    @Test fun `loading more pages only Recently added`() = runTest {
        val f = open(pageSize = 4)
        val before = f.server.requests

        f.model.loadMore()
        testScheduler.runCurrent()

        assertEquals(before + 1, f.server.requests)
        val last = f.server.pages.last()
        assertEquals(BrowseTab.ALL, last.first)
        assertEquals(4, last.second)
    }

    @Test fun `offline the dashboard reports one failure, keeps no figures and counts no cached rows`() = runTest {
        val server = DashboardServer(library).apply { offline = true; cache.value = library.take(2) }
        val f = open(server)

        assertEquals(1, f.failures.size)
        assertNull(f.model.state.value.summary)
        assertNull(f.model.state.value.total)
        assertEquals(setOf(DocumentKind.IMAGE), f.model.state.value.cachedKinds)
        assertFalse(f.model.state.value.recent.documents.fetched)
    }

    @Test fun `a summary read earlier stays on screen when a later read fails`() = runTest {
        val f = open()
        f.server.offline = true

        f.model.refresh()
        testScheduler.runCurrent()

        assertEquals(9, f.model.state.value.summary?.image?.count)
    }

    @Test fun `the viewer sequence from the dashboard is the loaded Recently added list in upload order, every kind`() = runTest {
        val f = open()

        val ids = f.model.prepareSequence().initialIds

        assertEquals(library.sortedByDescending { it.created_at }.map { it.id }, ids)
        assertTrue(ids.any { it.startsWith("v") } && ids.any { it.startsWith("f") })
    }

    @Test fun `a kind screen keeps its own paging, selection and a viewer sequence of its kind only`() = runTest {
        val server = DashboardServer(library)
        val f = open(server)
        val photos = BrowseFeedModel(
            scope = backgroundScope as CoroutineScope, tab = BrowseTab.PHOTOS, cache = server.cache,
            fetchPage = { offset -> server.page(BrowseTab.PHOTOS, offset, 4) },
            computation = UnconfinedTestDispatcher(testScheduler), sharing = SharingStarted.Eagerly,
        )
        testScheduler.runCurrent()

        photos.loadMore()
        testScheduler.runCurrent()
        photos.enterSelection(listOf("p5"))
        f.model.enterSelection(listOf("f1"))

        assertEquals("the kind screen read its own pages", 8, photos.state.first().documents.documents.size)
        assertEquals(setOf("p5"), photos.selectedIds)
        assertEquals("the dashboard's selection is its own", setOf("f1"), f.model.selectedIds)
        val sequence = photos.prepareSequence().initialIds
        assertEquals(8, sequence.size)
        assertTrue(sequence.all { it.startsWith("p") })
    }
}

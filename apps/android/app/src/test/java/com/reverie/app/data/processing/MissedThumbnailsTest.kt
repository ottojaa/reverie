package com.reverie.app.data.processing

import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.JobEventDto
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.local.PrivateDocumentStore
import com.reverie.app.data.local.toCacheableEntities
import com.reverie.app.data.realtime.DocumentJobEvents
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FakeDocumentDao
import com.reverie.app.data.repository.NoopPurger
import com.reverie.app.ui.screens.browse.doc
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MissedThumbnailsTest {

    private val dao = FakeDocumentDao()

    private suspend fun cache(id: String, thumbnail: JobStatus) {
        dao.upsertAll(listOf(doc(id).copy(thumbnail_status = thumbnail)).toCacheableEntities(0))
    }

    private fun TestScope.missedThumbnails(): MissedThumbnails {
        val dispatcher = UnconfinedTestDispatcher(testScheduler)
        val api = DocumentsApi(HttpClient(MockEngine { respondError(HttpStatusCode.NotFound) }))
        val repository = DocumentRepository(dao, api, PrivateDocumentStore(), NoopPurger, dispatcher)
        // Signed out, so the tracker stays idle: only what is awaited is under test.
        val tracker = ProcessingTracker(repository, SilentJobEvents, flowOf(false), backgroundScope)
        return MissedThumbnails(repository, tracker, CoroutineScope(backgroundScope.coroutineContext + dispatcher))
    }

    @Test
    fun `a miss that stops being awaited is forgotten, while the others stay`() = runTest(UnconfinedTestDispatcher()) {
        cache("a", JobStatus.PENDING)
        cache("b", JobStatus.PENDING)
        val missed = missedThumbnails()
        missed.awaited.launchIn(backgroundScope)
        missed.add("a")
        missed.add("b")
        assertEquals(setOf("a", "b"), missed.awaited.value)

        cache("a", JobStatus.COMPLETE)

        assertEquals(setOf("b"), missed.awaited.value)
        assertEquals("only the remaining miss is watched", setOf("b"), dao.statusQueries.last())
        cache("a", JobStatus.PENDING)
        assertEquals("a forgotten miss needs a new one", setOf("b"), missed.awaited.value)
    }

    private object SilentJobEvents : DocumentJobEvents {
        override val events = MutableSharedFlow<JobEventDto>()
        override val connected = MutableStateFlow(false)
        override val foregrounded = MutableStateFlow(false)
        override suspend fun subscribeDocument(documentId: String) = AutoCloseable {}
    }
}

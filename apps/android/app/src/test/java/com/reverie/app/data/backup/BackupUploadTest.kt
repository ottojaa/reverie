package com.reverie.app.data.backup

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.FoldersApi
import com.reverie.app.data.api.UploadApi
import com.reverie.app.data.upload.ContentHasher
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** A backup upload tells the server to process the file behind everything the user uploads by hand. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class BackupUploadTest {

    private val sent = mutableListOf<String>()

    private val client = HttpClient(MockEngine { request ->
        sent += request.body.toByteArray().decodeToString()
        respond(UPLOADED, headers = headersOf(HttpHeaders.ContentType, "application/json"))
    }) {
        expectSuccess = false
        install(HttpTimeout)
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    @Test fun `a backup upload is sent in the background lane`(): Unit = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val video = BackupMedia(1, "VID_1.mp4", "video/mp4", 5, bucketId = 1)
        shadowOf(context.contentResolver).registerInputStream(video.toUri(), "bytes".byteInputStream())
        val transport = MediaStoreBackupTransport(context, ContentHasher(context, Dispatchers.IO), DocumentsApi(client), UploadApi(client), FoldersApi(client))

        transport.upload(video, folderId = "folder")

        val body = sent.single()
        assertTrue(body, Regex("name=lane\r\n(?:[^\r\n]+\r\n)*\r\nbackground\r\n").containsMatchIn(body))
    }

    private companion object {
        const val UPLOADED = """{"session_id":"s","documents":[],"jobs":[]}"""
    }
}

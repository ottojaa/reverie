package com.reverie.app.data.api

import com.reverie.app.data.api.model.UploadResponse
import io.ktor.client.HttpClient
import io.ktor.client.plugins.onUpload
import io.ktor.client.request.forms.ChannelProvider
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.util.cio.readChannel
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UploadApi @Inject constructor(
    private val client: HttpClient,
) {
    /**
     * Upload one staged file. Streams the body (never buffers the whole file) and reports
     * byte progress via [onProgress]. All files in a batch share the same [sessionId] so
     * their processing events route to the same Socket.IO room.
     */
    suspend fun uploadFile(
        sessionId: String,
        folderId: String,
        file: File,
        filename: String,
        mimeType: String,
        conflictStrategy: String?,
        onProgress: (sent: Long, total: Long) -> Unit,
    ): UploadResponse {
        val response = client.submitFormWithBinaryData(
            url = "upload",
            formData = formData {
                append("folder_id", folderId)
                append("session_id", sessionId)
                conflictStrategy?.let { append("conflict_strategy", it) }
                append(
                    key = "files",
                    value = ChannelProvider(size = file.length()) { file.readChannel() },
                    headers = Headers.build {
                        append(HttpHeaders.ContentDisposition, "filename=\"$filename\"")
                        append(HttpHeaders.ContentType, mimeType)
                    },
                )
            },
        ) {
            onUpload { sent, total -> onProgress(sent, total ?: file.length()) }
        }
        return response.decode()
    }
}

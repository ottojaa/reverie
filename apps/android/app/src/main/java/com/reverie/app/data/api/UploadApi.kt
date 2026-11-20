package com.reverie.app.data.api

import com.reverie.app.data.api.model.UploadResponse
import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeoutConfig
import io.ktor.client.plugins.onUpload
import io.ktor.client.plugins.timeout
import io.ktor.client.request.forms.ChannelProvider
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.util.cio.readChannel
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.jvm.javaio.toByteReadChannel
import java.io.File
import java.io.InputStream
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
        onProgress: suspend (sent: Long, total: Long) -> Unit,
    ): UploadResponse = submit(
        sessionId = sessionId,
        folderId = folderId,
        filename = filename,
        mimeType = mimeType,
        conflictStrategy = conflictStrategy,
        size = file.length(),
        body = { file.readChannel() },
        onProgress = onProgress,
    )

    /**
     * Upload a file straight from a stream (a `content://` URI the caller opens), with no copy on
     * disk. [size] is the byte count when known; null sends the body without a declared length.
     * [openStream] is called once per attempt and the stream is closed when the body has been sent.
     */
    suspend fun uploadStream(
        sessionId: String,
        folderId: String,
        filename: String,
        mimeType: String,
        conflictStrategy: String?,
        size: Long?,
        openStream: () -> InputStream,
    ): UploadResponse = submit(
        sessionId = sessionId,
        folderId = folderId,
        filename = filename,
        mimeType = mimeType,
        conflictStrategy = conflictStrategy,
        size = size,
        body = { openStream().toByteReadChannel() },
        onProgress = { _, _ -> },
        // A big video can take far longer than the client's 60 s request limit; the socket limit still catches a stalled transfer.
        unlimitedRequestTime = true,
    )

    private suspend fun submit(
        sessionId: String,
        folderId: String,
        filename: String,
        mimeType: String,
        conflictStrategy: String?,
        size: Long?,
        body: () -> ByteReadChannel,
        onProgress: suspend (sent: Long, total: Long) -> Unit,
        unlimitedRequestTime: Boolean = false,
    ): UploadResponse {
        val response = client.submitFormWithBinaryData(
            url = "upload",
            formData = formData {
                append("folder_id", folderId)
                append("session_id", sessionId)
                conflictStrategy?.let { append("conflict_strategy", it) }
                append(
                    key = "files",
                    value = ChannelProvider(size = size, block = body),
                    headers = Headers.build {
                        append(HttpHeaders.ContentDisposition, "filename=\"$filename\"")
                        append(HttpHeaders.ContentType, mimeType)
                    },
                )
            },
        ) {
            onUpload { sent, total -> onProgress(sent, total ?: size ?: 0L) }
            if (unlimitedRequestTime) timeout { requestTimeoutMillis = HttpTimeoutConfig.INFINITE_TIMEOUT_MS }
        }
        return response.decode()
    }
}

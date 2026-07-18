package com.reverie.app.data.api

import com.reverie.app.data.api.model.BatchDeleteDocuments
import com.reverie.app.data.api.model.CheckDuplicatesRequest
import com.reverie.app.data.api.model.CheckDuplicatesResponse
import com.reverie.app.data.api.model.ConflictStrategy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentOcrResult
import com.reverie.app.data.api.model.DocumentStatusResponse
import com.reverie.app.data.api.model.JobIdResponse
import com.reverie.app.data.api.model.MoveDocumentsRequest
import com.reverie.app.data.api.model.Paginated
import com.reverie.app.data.api.model.SetDocumentPrivacyRequest
import com.reverie.app.data.api.model.UpdateDocumentRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DocumentsApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun list(
        limit: Int,
        offset: Int,
        folderId: String? = null,
        category: String? = null,
    ): Paginated<DocumentDto> = client.get("documents") {
        parameter("limit", limit)
        parameter("offset", offset)
        folderId?.let { parameter("folder_id", it) }
        category?.let { parameter("category", it) }
    }.decode()

    suspend fun get(id: String): DocumentDto = client.get("documents/$id").decode()

    suspend fun delete(id: String) = client.delete("documents/$id").throwIfError()

    suspend fun deleteBatch(ids: List<String>) = client.delete("documents") {
        contentType(ContentType.Application.Json)
        setBody(BatchDeleteDocuments(ids))
    }.throwIfError()

    suspend fun setPrivacy(ids: List<String>, isPrivate: Boolean) = client.patch("documents/privacy") {
        contentType(ContentType.Application.Json)
        setBody(SetDocumentPrivacyRequest(ids, isPrivate))
    }.throwIfError()

    suspend fun rename(id: String, filename: String): DocumentDto = client.patch("documents/$id") {
        contentType(ContentType.Application.Json)
        setBody(UpdateDocumentRequest(filename))
    }.decode()

    suspend fun move(ids: List<String>, folderId: String, conflict: ConflictStrategy?) =
        client.patch("documents/move") {
            contentType(ContentType.Application.Json)
            setBody(MoveDocumentsRequest(ids, folderId, conflict))
        }.throwIfError()

    suspend fun checkDuplicates(folderId: String, filenames: List<String>): CheckDuplicatesResponse =
        client.post("documents/check-duplicates") {
            contentType(ContentType.Application.Json)
            setBody(CheckDuplicatesRequest(folderId, filenames))
        }.decode()

    suspend fun status(id: String): DocumentStatusResponse = client.get("documents/$id/status").decode()

    suspend fun ocrResult(id: String): DocumentOcrResult = client.get("documents/$id/ocr").decode()

    suspend fun retryOcr(id: String): JobIdResponse = client.post("documents/$id/ocr/retry").decode()

    suspend fun reprocessLlm(id: String): JobIdResponse = client.post("documents/$id/reprocess-llm").decode()
}

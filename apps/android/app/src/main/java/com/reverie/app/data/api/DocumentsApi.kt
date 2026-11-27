package com.reverie.app.data.api

import com.reverie.app.data.api.model.BatchDeleteDocuments
import com.reverie.app.data.api.model.CheckContentRequest
import com.reverie.app.data.api.model.CheckContentResponse
import com.reverie.app.data.api.model.CheckDuplicatesRequest
import com.reverie.app.data.api.model.CheckDuplicatesResponse
import com.reverie.app.data.api.model.ConflictStrategy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentOcrResult
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.DocumentStatusResponse
import com.reverie.app.data.api.model.JobIdResponse
import com.reverie.app.data.api.model.Paginated
import com.reverie.app.data.api.model.UpdateDocumentRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DocumentsApi @Inject constructor(
    private val client: HttpClient,
) {
    /**
     * One page of [scope]'s documents of [filter]'s kinds. [processing] keeps only those still being
     * processed; [preview] puts screenshots and screen recordings last, for picking cover pictures.
     */
    suspend fun list(
        limit: Int,
        offset: Int,
        scope: DocumentScope = DocumentScope.All,
        filter: DocumentFilter = DocumentFilter.ALL,
        processing: Boolean = false,
        preview: Boolean = false,
        sort: DocumentSort = DocumentSort.NEWEST,
    ): Paginated<DocumentDto> = client.get("documents") {
        parameter("limit", limit)
        parameter("offset", offset)
        scopeParameter(scope)
        if (filter == DocumentFilter.MEDIA) parameter("media", true)
        filter.singleKind?.let { parameter("kind", it.wire) }
        if (processing) parameter("processing", true)
        if (preview) parameter("preview", true)
        sort.wire?.let { parameter("sort", it) }
    }.decode()

    /** Count and size per kind of [scope]'s documents. */
    suspend fun summary(scope: DocumentScope = DocumentScope.All): DocumentSummaryDto = client.get("documents/summary") {
        scopeParameter(scope)
    }.decode()

    suspend fun get(id: String): DocumentDto = client.get("documents/$id").decode()

    suspend fun delete(id: String) = client.delete("documents/$id").throwIfError()

    suspend fun deleteBatch(ids: List<String>) = client.delete("documents") {
        contentType(ContentType.Application.Json)
        setBody(BatchDeleteDocuments(ids))
    }.throwIfError()

    suspend fun rename(id: String, filename: String): DocumentDto = client.patch("documents/$id") {
        contentType(ContentType.Application.Json)
        setBody(UpdateDocumentRequest(filename))
    }.decode()

    /**
     * Moves documents into [folderId], or to the top level when it is null. Without a [conflict]
     * strategy the server lets a name end up twice, so ask [checkDuplicates] first.
     */
    suspend fun move(ids: List<String>, folderId: String?, conflict: ConflictStrategy?) =
        client.patch("documents/move") {
            contentType(ContentType.Application.Json)
            // Built by hand: the JSON settings leave out null properties, and here null is the destination.
            setBody(
                buildJsonObject {
                    putJsonArray("document_ids") { ids.forEach { add(it) } }
                    put("folder_id", folderId)
                    conflict?.let { put("conflict_strategy", it.wire) }
                },
            )
        }.throwIfError()

    /** Which of [filenames] are already taken in [folderId] (null: at the top level). */
    suspend fun checkDuplicates(folderId: String?, filenames: List<String>): CheckDuplicatesResponse =
        client.post("documents/check-duplicates") {
            contentType(ContentType.Application.Json)
            setBody(CheckDuplicatesRequest(folderId, top_level = true.takeIf { folderId == null }, filenames))
        }.decode()

    suspend fun checkContent(request: CheckContentRequest): CheckContentResponse =
        client.post("documents/check-content") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.decode()

    suspend fun status(id: String): DocumentStatusResponse = client.get("documents/$id/status").decode()

    suspend fun ocrResult(id: String): DocumentOcrResult = client.get("documents/$id/ocr").decode()

    suspend fun retryOcr(id: String): JobIdResponse = client.post("documents/$id/ocr/retry").decode()

    suspend fun reprocessLlm(id: String): JobIdResponse = client.post("documents/$id/reprocess-llm").decode()
}

private fun HttpRequestBuilder.scopeParameter(scope: DocumentScope) {
    when (scope) {
        DocumentScope.All -> Unit
        DocumentScope.TopLevel -> parameter("top_level", true)
        is DocumentScope.Folder -> parameter("folder_id", scope.id)
    }
}

package com.reverie.app.data.api

import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.ReorderFoldersRequest
import com.reverie.app.data.api.model.UpdateFolderRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FoldersApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun tree(): List<FolderWithChildren> = client.get("folders/tree").decode()

    suspend fun get(id: String): FolderDto = client.get("folders/$id").decode()

    suspend fun create(request: CreateFolderRequest): FolderDto = client.post("folders") {
        contentType(ContentType.Application.Json)
        setBody(request)
    }.decode()

    suspend fun update(id: String, request: UpdateFolderRequest): FolderDto = client.patch("folders/$id") {
        contentType(ContentType.Application.Json)
        setBody(request)
    }.decode()

    suspend fun delete(id: String) = client.delete("folders/$id").throwIfError()

    suspend fun reorder(request: ReorderFoldersRequest) = client.put("folders/reorder") {
        contentType(ContentType.Application.Json)
        setBody(request)
    }.throwIfError()
}

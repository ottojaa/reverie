package com.reverie.app.data.api

import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.data.api.model.TrashResultDto
import com.reverie.app.data.api.model.TrashSelectionRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TrashApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun list(): TrashListDto = client.get("trash").decode()

    suspend fun restore(selection: TrashSelectionRequest): TrashResultDto = client.post("trash/restore") {
        contentType(ContentType.Application.Json)
        setBody(selection)
    }.decode()

    /** Deletes the selected items for good. */
    suspend fun purge(selection: TrashSelectionRequest): TrashResultDto = client.post("trash/purge") {
        contentType(ContentType.Application.Json)
        setBody(selection)
    }.decode()
}

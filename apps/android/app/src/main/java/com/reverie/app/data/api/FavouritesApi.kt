package com.reverie.app.data.api

import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteListResponse
import com.reverie.app.data.api.model.SetFavouriteRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FavouritesApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun list(): List<FavouriteDto> = client.get("favourites").decode<FavouriteListResponse>().items

    suspend fun set(key: FavouriteKey, isFavourite: Boolean) = client.put("favourites/${key.type.wire}/${key.id}") {
        contentType(ContentType.Application.Json)
        setBody(SetFavouriteRequest(isFavourite))
    }.throwIfError()
}

package com.reverie.app.data.api.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** What a star is on. Collections count as folders. */
@Serializable
enum class FavouriteType(val wire: String) {
    @SerialName("folder") FOLDER("folder"),
    @SerialName("document") DOCUMENT("document"),
}

/** One starred thing, whether or not its details are known. */
data class FavouriteKey(val type: FavouriteType, val id: String)

@Serializable
data class FavouriteLocationDto(val id: String, val name: String)

/**
 * One entry of GET /favourites. A private one carries no [location], [folder] or [document], whether
 * or not its lock is open: only what is needed to unlock ([lockId]) and open it.
 */
@Immutable
@Serializable
data class FavouriteDto(
    val type: FavouriteType,
    val id: String,
    val starred_at: String,
    @SerialName("private") val isPrivate: Boolean,
    val locked: Boolean = false,
    @SerialName("lock_id") val lockId: String? = null,
    /** The chain of parents, collection first. */
    val location: List<FavouriteLocationDto>? = null,
    val folder: FolderWithChildren? = null,
    val document: DocumentDto? = null,
) {
    val key: FavouriteKey get() = FavouriteKey(type, id)
}

@Serializable
data class FavouriteListResponse(val items: List<FavouriteDto>)

@Serializable
data class SetFavouriteRequest(@SerialName("is_favourite") val isFavourite: Boolean)

package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** A locally-stored recent search query (there is no server endpoint for these). */
@Entity(tableName = "search_history")
data class SearchHistoryEntity(
    @PrimaryKey val query: String,
    val lastUsedAt: Long,
    val useCount: Int,
)

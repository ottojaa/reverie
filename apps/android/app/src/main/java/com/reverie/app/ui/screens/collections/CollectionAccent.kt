package com.reverie.app.ui.screens.collections

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

/**
 * One collection's accent colour, in a shade for each theme: the light shade is darker so the icon
 * and the tinted tile behind it keep their contrast on a light surface.
 */
@Immutable
data class CollectionAccent(val dark: Color, val light: Color) {
    fun forTheme(isDark: Boolean): Color = if (isDark) dark else light
}

internal val COLLECTION_ACCENTS: List<CollectionAccent> = listOf(
    CollectionAccent(dark = Color(0xFF60A5FA), light = Color(0xFF2563EB)), // blue
    CollectionAccent(dark = Color(0xFF4ADE80), light = Color(0xFF15803D)), // green
    CollectionAccent(dark = Color(0xFFFB923C), light = Color(0xFFC2410C)), // orange
    CollectionAccent(dark = Color(0xFF8B9CF5), light = Color(0xFF4F46E5)), // indigo
    CollectionAccent(dark = Color(0xFFF472B6), light = Color(0xFFBE185D)), // pink
    CollectionAccent(dark = Color(0xFFFBBF24), light = Color(0xFFB45309)), // amber
    CollectionAccent(dark = Color(0xFF2DD4BF), light = Color(0xFF0F766E)), // teal
    CollectionAccent(dark = Color(0xFFA78BFA), light = Color(0xFF6D28D9)), // violet
)

/**
 * The accent for a collection id. A fixed hash (FNV-1a) rather than [String.hashCode] or an
 * index in the list, so the colour is the same on every run and does not move when the user
 * reorders, adds or deletes collections.
 */
fun collectionAccent(id: String): CollectionAccent {
    var hash = FNV_OFFSET
    id.forEach { hash = (hash xor it.code) * FNV_PRIME }

    return COLLECTION_ACCENTS[Math.floorMod(hash, COLLECTION_ACCENTS.size)]
}

private const val FNV_OFFSET = -2128831035 // 0x811C9DC5
private const val FNV_PRIME = 16777619

/** The accent's shade for the theme that is showing, judged by the background so dynamic colour works too. */
@Composable
fun CollectionAccent.current(): Color = forTheme(MaterialTheme.colorScheme.background.luminance() < 0.5f)

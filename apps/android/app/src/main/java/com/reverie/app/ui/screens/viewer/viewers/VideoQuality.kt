package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.datasource.HttpDataSource

/** Auto picks the rung by bandwidth; anything else pins one rung of the HLS ladder. */
internal const val AUTO_QUALITY_LABEL = "Auto"

// An HLS token the server refuses answers 403 (tampered) or 410 (expired). The stream's segments
// each carry the token, so playback running past its lifetime (or a paused video resumed later)
// hits this mid-stream; the cure is a freshly signed URL, not the original (signed at the same time).
private val TOKEN_REFUSAL_CODES = setOf(403, 410)

// The per-document path token in an HLS URL: `/files/hls/{exp}/{sig}/{hash}/...`. It changes on every
// signing; the content hash after it does not.
private val HLS_TOKEN = Regex("/files/hls/\\d+/[^/]+/")

/** One rung of the ladder, as the track selection knows it. */
internal data class VideoQualityLevel(
    val label: String,
    val height: Int,
    val groupIndex: Int,
    val trackIndex: Int,
)

/** "1080p" for a 1920x1080 or 1080x1920 rung: named by the picture's shorter side, as the web viewer does. */
internal fun toQualityLabel(width: Int, height: Int): String = "${minOf(width, height)}p"

/** The HLS URL without its signing token, so a rotated signature doesn't look like a different video. */
internal fun toHlsSetKey(hlsUrl: String): String = hlsUrl.substringBefore('?').replace(HLS_TOKEN, "/files/hls/")

internal fun isTokenRefusal(error: PlaybackException): Boolean =
    generateSequence<Throwable>(error) { it.cause }
        .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
        .any { it.responseCode in TOKEN_REFUSAL_CODES }

/** The adaptive video group of the current tracks, if the stream offers more than one rung. */
private fun Tracks.adaptiveVideoGroup(): Tracks.Group? =
    groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO && it.length > 1 }

/** The playable rungs, best first. Empty for a single-rung stream (nothing to choose). */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal fun toQualityLevels(tracks: Tracks): List<VideoQualityLevel> {
    val group = tracks.adaptiveVideoGroup() ?: return emptyList()
    val groupIndex = tracks.groups.indexOf(group)

    return (0 until group.length)
        .filter { group.isTrackSupported(it) }
        .map { index ->
            val format = group.getTrackFormat(index)
            VideoQualityLevel(toQualityLabel(format.width, format.height), minOf(format.width, format.height), groupIndex, index)
        }
        .sortedByDescending { it.height }
}

/** The rung currently being decoded, for the "Auto · 720p" readout. */
internal fun toPlayingLabel(tracks: Tracks): String? {
    val group = tracks.adaptiveVideoGroup() ?: return null
    val index = (0 until group.length).firstOrNull { group.isTrackSelected(it) } ?: return null

    return toQualityLabel(group.getTrackFormat(index).width, group.getTrackFormat(index).height)
}

/** Pins [level], or hands the choice back to bandwidth (Auto) for null. */
internal fun selectQuality(player: Player, level: VideoQualityLevel?) {
    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().apply {
        if (level == null) {
            clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            return@apply
        }
        val group = player.currentTracks.groups[level.groupIndex].mediaTrackGroup
        setOverrideForType(TrackSelectionOverride(group, level.trackIndex))
    }.build()
}

/**
 * The quality control over the video: a glass pill with the current choice, opening Auto + one entry
 * per rung. [pinned] is the pinned rung (null = Auto); [playingLabel] is what Auto currently plays.
 */
@Composable
internal fun QualityMenuButton(
    levels: List<VideoQualityLevel>,
    pinned: VideoQualityLevel?,
    playingLabel: String?,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onSelect: (VideoQualityLevel?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val summary = pinned?.label ?: listOfNotNull(AUTO_QUALITY_LABEL, playingLabel).joinToString(" · ")

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = Color.Black.copy(alpha = 0.55f),
        contentColor = Color.White,
    ) {
        Row(Modifier.clickable { onExpandedChange(true) }.padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(summary, style = MaterialTheme.typography.labelMedium)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { onExpandedChange(false) }) {
            QualityItem(AUTO_QUALITY_LABEL, selected = pinned == null) { onSelect(null) }
            levels.forEach { level -> QualityItem(level.label, selected = level == pinned) { onSelect(level) } }
        }
    }
}

@Composable
private fun QualityItem(label: String, selected: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { RadioButton(selected = selected, onClick = null) },
        onClick = onClick,
    )
}


package com.reverie.app.ui.screens.viewer.insight

import com.reverie.app.data.api.model.DocumentPhotoMetadata
import com.reverie.app.data.api.model.DocumentVideoMetadata
import com.reverie.app.util.formatDuration
import java.util.Locale

/**
 * Pure formatters for the camera and video rows of the DETAILS card. Each returns the row's primary and
 * secondary line, or null when the file carried nothing worth a row.
 */

/** "Apple iPhone 15 Pro" over "ISO 80 · f/1.8 · 1/120 s · 6.8 mm (24 mm equiv.)". */
fun cameraSummary(photo: DocumentPhotoMetadata): Pair<String, String?>? {
    val camera = joinCamera(photo.camera_make, photo.camera_model)
    val exposure = listOfNotNull(
        photo.iso?.let { "ISO $it" },
        photo.f_number?.let { "f/${trimmed(it, 1)}" },
        photo.exposure_time?.let { formatExposureTime(it) },
        formatFocalLength(photo.focal_length, photo.focal_length_35mm),
        if (photo.flash_fired == true) "Flash" else null,
    ).joinToString(" · ").ifBlank { null }

    if (camera == null) return exposure?.let { it to null }

    return camera to exposure
}

/** "HEVC · 4K HDR · 29.97 fps" over "AAC · 42.5 Mbit/s · 1:02:07". */
fun videoSummary(video: DocumentVideoMetadata, durationSeconds: Double?): Pair<String, String?>? {
    val picture = listOfNotNull(
        video.video_codec?.let { codecLabel(it) },
        displayedSize(video),
        if (video.is_hdr) "HDR" else null,
        video.frame_rate?.let { "${trimmed(it, 2)} fps" },
    ).joinToString(" · ")
    val rest = listOfNotNull(
        video.audio_codec?.let { codecLabel(it) } ?: "No audio".takeIf { video.video_codec != null },
        video.bitrate?.let { formatBitrate(it) },
        durationSeconds?.let { formatDuration(it) },
    ).joinToString(" · ").ifBlank { null }

    if (picture.isBlank()) return rest?.let { it to null }

    return picture to rest
}

private fun joinCamera(make: String?, model: String?): String? {
    if (model == null) return make
    if (make == null || model.startsWith(make, ignoreCase = true)) return model

    return "$make $model"
}

/** 1/120 s for a fast shutter, 0.5 s or 30 s for a slow one. */
fun formatExposureTime(seconds: Double): String {
    if (seconds <= 0) return ""
    if (seconds >= 1) return "${trimmed(seconds, 1)} s"

    return "1/${Math.round(1 / seconds)} s"
}

fun formatFocalLength(real: Double?, equivalent: Double?): String? {
    if (real == null) return equivalent?.let { "${trimmed(it, 0)} mm equiv." }
    if (equivalent == null || Math.round(real) == Math.round(equivalent)) return "${trimmed(real, 1)} mm"

    return "${trimmed(real, 1)} mm (${trimmed(equivalent, 0)} mm equiv.)"
}

fun formatBitrate(bitsPerSecond: Long): String =
    if (bitsPerSecond >= 1_000_000) "${trimmed(bitsPerSecond / 1_000_000.0, 1)} Mbit/s" else "${bitsPerSecond / 1000} kbit/s"

/** The size a player shows: a clip stored sideways (rotation 90 or 270) swaps width and height. */
private fun displayedSize(video: DocumentVideoMetadata): String? {
    val width = video.width ?: return null
    val height = video.height ?: return null
    val sideways = video.rotation == 90 || video.rotation == 270

    return if (sideways) "$height × $width" else "$width × $height"
}

private fun codecLabel(codec: String): String = when (codec.lowercase()) {
    "h264" -> "H.264"
    "hevc" -> "HEVC"
    "mpeg4" -> "MPEG-4"
    else -> codec.uppercase()
}

/** A number with at most `decimals` places and no trailing zeros: 1.80 → "1.8", 30.0 → "30". */
private fun trimmed(value: Double, decimals: Int): String =
    String.format(Locale.US, "%.${decimals}f", value).let { if (it.contains('.')) it.trimEnd('0').trimEnd('.') else it }

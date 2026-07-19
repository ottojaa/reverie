package com.reverie.app.util

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow

private val shortDateFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)

/** Parse an ISO-8601 instant (or a YYYY-MM-DD date) into a short local date, e.g. "Jun 1, 2024". */
fun formatShortDate(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching {
        toLocalDate(iso).format(shortDateFormatter)
    }.getOrDefault("")
}

private fun toLocalDate(iso: String): LocalDate =
    if (iso.length == 10) LocalDate.parse(iso)
    else Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()

/** A coarse date bucket label for grouping search results: Today / This week / 2023 / … */
fun dateBucket(iso: String?): String {
    if (iso.isNullOrBlank()) return "Undated"
    val date = runCatching { toLocalDate(iso) }.getOrNull() ?: return "Undated"
    val today = LocalDate.now()
    return when {
        date == today -> "Today"
        date == today.minusDays(1) -> "Yesterday"
        date.isAfter(today.minusDays(7)) -> "This week"
        date.month == today.month && date.year == today.year -> "This month"
        date.year == today.year -> "This year"
        else -> date.year.toString()
    }
}

/** Clock-style video duration: "m:ss", or "h:mm:ss" once it reaches an hour. */
fun formatDuration(seconds: Double): String {
    val total = seconds.toLong().coerceAtLeast(0)
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val secs = total % 60
    return if (hours > 0) {
        String.format(Locale.US, "%d:%02d:%02d", hours, minutes, secs)
    } else {
        String.format(Locale.US, "%d:%02d", minutes, secs)
    }
}

/** Human-readable byte size, e.g. 12.4 GB. */
fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KB", "MB", "GB", "TB", "PB")
    val exp = (ln(bytes.toDouble()) / ln(1024.0)).toInt().coerceIn(1, units.size)
    val value = bytes / 1024.0.pow(exp.toDouble())
    val pattern = if (value >= 100 || value == value.toLong().toDouble()) "%.0f %s" else "%.1f %s"
    return String.format(Locale.US, pattern, value, units[exp - 1])
}

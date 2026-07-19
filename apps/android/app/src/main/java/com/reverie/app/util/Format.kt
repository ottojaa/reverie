package com.reverie.app.util

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow

private val shortDateFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
private val dayDateFormatter = DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.US)
private val timeOfDayFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.US)

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

/**
 * Weekday-led date for scannable detail rows, e.g. "Mon, 27 Oct 2003". The leading weekday is the
 * parseability win over [formatShortDate]; empty on a parse failure.
 */
fun formatDayDate(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching { toLocalDate(iso).format(dayDateFormatter) }.getOrDefault("")
}

/** Local time-of-day "HH:mm" when the timestamp carries one; null for date-only values (never fabricate midnight). */
fun formatTimeOfDay(iso: String?): String? {
    if (iso.isNullOrBlank() || iso.length == 10) return null
    return runCatching {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalTime().format(timeOfDayFormatter)
    }.getOrNull()
}

/**
 * Coarse "how long ago" for a detail row's secondary line: today / yesterday / N days ago /
 * N weeks ago; null once it's older than ~a month (the absolute date already carries it) or unparseable.
 * Prose-oriented, unlike [dateBucket] which produces group headers.
 */
fun formatRelativeAge(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    val date = runCatching { toLocalDate(iso) }.getOrNull() ?: return null
    val days = ChronoUnit.DAYS.between(date, LocalDate.now())
    return when {
        days < 0L -> null
        days == 0L -> "today"
        days == 1L -> "yesterday"
        days < 7L -> "$days days ago"
        days < 30L -> (days / 7).let { "$it ${if (it == 1L) "week" else "weeks"} ago" }
        else -> null
    }
}

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
